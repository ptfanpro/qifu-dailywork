import fs from 'node:fs';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_DIRECTORY = /^\d{4}-\d{2}-\d{2}$/;

function readJson(file, fallback = null) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; }
  catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  try { fs.renameSync(temporary, file); }
  catch (error) {
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    fs.copyFileSync(temporary, file);
    fs.unlinkSync(temporary);
  }
}

function assertLocalStateRoot(localStateRoot) {
  const root = path.resolve(localStateRoot);
  if (path.basename(root) !== '祈福运行数据') throw new Error(`拒绝清理非祈福运行数据目录：${root}`);
  if (path.dirname(root) === root || root === path.parse(root).root) throw new Error(`拒绝清理宽泛目录：${root}`);
  return root;
}

function assertInside(root, target) {
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`清理目标超出本机运行目录：${resolved}`);
  return resolved;
}

function bytesRecursive(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes:true })) total += bytesRecursive(path.join(target, entry.name));
  return total;
}

function removeTracked(root, target, report, reason, dryRun) {
  const resolved = assertInside(root, target);
  if (!fs.existsSync(resolved)) return false;
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) {
    report.skippedItems.push({ target:resolved, reason:'symbolic-link' });
    return false;
  }
  const bytes = bytesRecursive(resolved);
  if (!dryRun) fs.rmSync(resolved, { recursive:true, force:true });
  report.deleted.push({ target:resolved, reason, bytes });
  report.deletedBytes += bytes;
  return true;
}

function removeIfStale(root, target, report, nowMs, staleMs, reason, dryRun) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || nowMs - stat.mtimeMs < staleMs) return;
  removeTracked(root, target, report, reason, dryRun);
}

function pruneTimingHistory(root, directory, report, keepCount, dryRun) {
  if (!fs.existsSync(directory)) return;
  for (const prefix of ['timing-previous-', 'timing-audit-previous-']) {
    const files = fs.readdirSync(directory, { withFileTypes:true })
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.json'))
      .map((entry) => path.join(directory, entry.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const file of files.slice(keepCount)) removeTracked(root, file, report, 'old-timing-history', dryRun);
  }
}

function photoWorkflowCompleted(photoDirectory) {
  const receipt = readJson(path.join(photoDirectory, 'scene-upload-receipt.json'), null);
  if (!receipt?.complete || receipt.tabletCompletionVerified !== true || !receipt.completedAt) return null;
  const completedAtMs = Date.parse(receipt.completedAt);
  return Number.isFinite(completedAtMs) ? { completedAtMs } : null;
}

function photoPreparationCompleted(photoDirectory) {
  const receipt = readJson(path.join(photoDirectory, 'photo-prepare-receipt.json'), null);
  if (!receipt?.completedAt || (Array.isArray(receipt.cleanupPending) && receipt.cleanupPending.length)) return null;
  const completedAtMs = Date.parse(receipt.completedAt);
  return Number.isFinite(completedAtMs) ? { completedAtMs } : null;
}

function scrubPurgedBackupReferences(photoDirectory, nowIso) {
  const receiptFile = path.join(photoDirectory, 'photo-prepare-receipt.json');
  const receipt = readJson(receiptFile, null);
  if (!receipt) return;
  receipt.backupDir = null;
  receipt.quarantineDir = null;
  receipt.cleanupPending = [];
  receipt.backupPurgedAt = nowIso;
  receipt.files = Array.isArray(receipt.files) ? receipt.files.map(({ backup, ...item }) => item) : receipt.files;
  receipt.duplicates = Array.isArray(receipt.duplicates) ? receipt.duplicates.map(({ backup, ...item }) => item) : receipt.duplicates;
  writeJsonAtomic(receiptFile, receipt);
}

export function cleanupLocalState(localStateRoot, options = {}) {
  const root = assertLocalStateRoot(localStateRoot);
  const nowMs = Number(options.nowMs ?? Date.now());
  const force = options.force === true;
  const dryRun = options.dryRun === true;
  const intervalMs = Number(options.intervalHours ?? 24) * 60 * 60 * 1000;
  const backupRetentionMs = Number(options.backupRetentionDays ?? 7) * DAY_MS;
  const staleTempMs = Number(options.staleTempHours ?? 24) * 60 * 60 * 1000;
  const timingHistoryLimit = Number(options.timingHistoryLimit ?? 5);
  const stateFile = path.join(root, 'cleanup-state.json');
  const previous = readJson(stateFile, null);
  const previousMs = previous?.lastRunAt ? Date.parse(previous.lastRunAt) : Number.NaN;
  if (!force && Number.isFinite(previousMs) && nowMs - previousMs < intervalMs) {
    return { schemaVersion:1, skipped:true, reason:'interval-not-due', lastRunAt:previous.lastRunAt, deleted:[], skippedItems:[], deletedBytes:0 };
  }

  const report = {
    schemaVersion:1,
    skipped:false,
    startedAt:new Date(nowMs).toISOString(),
    policy:{ backupRetentionDays:backupRetentionMs / DAY_MS, staleTempHours:staleTempMs / 3600000, timingHistoryLimit },
    deleted:[],
    skippedItems:[],
    deletedBytes:0,
  };
  const workdaysRoot = path.join(root, 'workdays');
  if (fs.existsSync(workdaysRoot)) {
    for (const entry of fs.readdirSync(workdaysRoot, { withFileTypes:true })) {
      if (!entry.isDirectory() || !DATE_DIRECTORY.test(entry.name)) continue;
      const workday = assertInside(root, path.join(workdaysRoot, entry.name));
      const photoDirectory = path.join(workday, 'photos');
      removeIfStale(root, path.join(workday, 'temp'), report, nowMs, staleTempMs, 'stale-pdf-temp', dryRun);
      removeIfStale(root, path.join(photoDirectory, 'temp'), report, nowMs, staleTempMs, 'stale-photo-temp', dryRun);
      removeIfStale(root, path.join(photoDirectory, 'photo-ocr-crops'), report, nowMs, staleTempMs, 'stale-ocr-crops', dryRun);
      removeIfStale(root, path.join(photoDirectory, 'pdf-code-crops'), report, nowMs, staleTempMs, 'stale-pdf-code-crops', dryRun);
      pruneTimingHistory(root, workday, report, timingHistoryLimit, dryRun);
      pruneTimingHistory(root, photoDirectory, report, timingHistoryLimit, dryRun);

      const preparation = photoPreparationCompleted(photoDirectory);
      if (preparation && nowMs - preparation.completedAtMs >= backupRetentionMs) {
        const purged = removeTracked(root, path.join(photoDirectory, 'photo-backups'), report, 'committed-photo-preparation-recovery-window-expired', dryRun);
        if (purged && !dryRun) scrubPurgedBackupReferences(photoDirectory, new Date(nowMs).toISOString());
      }
      const completion = photoWorkflowCompleted(photoDirectory);
      if (completion && nowMs - completion.completedAtMs >= backupRetentionMs) {
        for (const name of ['photo-staging', 'photo-quarantine']) {
          removeTracked(root, path.join(photoDirectory, name), report, 'completed-photo-workflow-recovery-window-expired', dryRun);
        }
      }
    }
  }
  report.completedAt = new Date(nowMs).toISOString();
  if (!dryRun) writeJsonAtomic(stateFile, {
    schemaVersion:1,
    lastRunAt:report.completedAt,
    deletedItemCount:report.deleted.length,
    deletedBytes:report.deletedBytes,
    policy:report.policy,
  });
  return report;
}
