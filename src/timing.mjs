import fs from 'node:fs';
import path from 'node:path';

const phases = ['date-resolution','pdf-index','photo-match','photoshop','upload','order-processing','pdf-query','pdf-export','pdf-finalize','tablet-renewal','quantity'];
const counterNames = ['photo_count','pdf_page_count','export_order_count','digit_direct_count','text_resolved_count','fingerprint_fallback_count','manual_review_count','browser_action_count','browser_reconnect_count','full_dom_snapshot_count','filechooser_manual_takeover_count','dialog_manual_takeover_count','download_event_wait_count','download_directory_watch_count','retry_count','duplicate_validation_count','user_intervention_count'];

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    // Windows/NAS 同步目录不保证 rename 可以覆盖现有文件。
    // copyFileSync 默认覆盖目标，随后清理临时文件，可避免流程被计时日志打断。
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    fs.copyFileSync(tmp, file);
    fs.unlinkSync(tmp);
  }
}

function archivePrevious(file, archivedFile) {
  if (!fs.existsSync(file)) return;
  try {
    fs.renameSync(file, archivedFile);
  } catch (error) {
    // OneDrive/NAS clients may briefly deny rename while still allowing reads.
    // A copied archive is sufficient because atomicJson replaces the live file next.
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    fs.copyFileSync(file, archivedFile);
  }
}

export class Timing {
  constructor(runDir, mode, businessDate) {
    this.file = path.join(runDir, 'timing.json'); this.auditFile = path.join(runDir, 'timing-audit.json');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    archivePrevious(this.file, path.join(runDir, `timing-previous-${stamp}.json`));
    archivePrevious(this.auditFile, path.join(runDir, `timing-audit-previous-${stamp}.json`));
    this.data = { schemaVersion: 1, mode, businessDate, startedAt: new Date().toISOString(), finishedAt: null, phases: [], events: [], counters: Object.fromEntries(counterNames.map((x) => [x, 0])) };
    atomicJson(this.file, this.data);
  }
  start(name) { if (!phases.includes(name)) throw new Error(`未知阶段 ${name}`); this.current = { phase: name, startedAt: new Date().toISOString() }; this.data.phases.push(this.current); this.save(); }
  end(status = 'completed', reasonCode = null) { if (!this.current) return; this.current.endedAt = new Date().toISOString(); this.current.durationSeconds = Math.round((Date.parse(this.current.endedAt) - Date.parse(this.current.startedAt)) / 10) / 100; this.current.status = status; this.current.reasonCode = reasonCode; this.current = null; this.save(); }
  count(name, value = 1) { this.data.counters[name] = (this.data.counters[name] ?? 0) + value; this.save(); }
  setCount(name, value = 0) { this.data.counters[name] = value; this.save(); }
  event(kind, phase, durationSeconds = 0) { this.data.events.push({ at: new Date().toISOString(), kind, phase, durationSeconds }); this.save(); }
  save() { atomicJson(this.file, this.data); }
  finish() {
    if (this.current) this.end('failed','unexpected-stop');
    this.data.finishedAt = new Date().toISOString(); this.save();
    const totals = {};
    for (const p of this.data.phases) totals[p.phase] = (totals[p.phase] ?? 0) + (p.durationSeconds ?? 0);
    const totalSeconds = Math.round((Date.parse(this.data.finishedAt) - Date.parse(this.data.startedAt)) / 10) / 100;
    const targetSeconds = { 'photo-only':600, 'pdf-only':360, combined:900 }[this.data.mode];
    atomicJson(this.auditFile, { schemaVersion: 1, mode: this.data.mode, businessDate: this.data.businessDate, totalSeconds, targetSeconds, withinTarget: totalSeconds <= targetSeconds, phaseTotals: totals, slowestPhases: Object.entries(totals).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([phase,seconds])=>({phase,seconds})), counters: this.data.counters, privacy: 'timing-and-counts-only' });
  }
}
