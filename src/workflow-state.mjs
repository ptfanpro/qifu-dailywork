import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyPdf } from './pdf.mjs';

function readJson(file, label) {
  if (!fs.existsSync(file)) throw new Error(`已有 PDF，但没有找到${label}：${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function isPdfWorkflowComplete(state) {
  return state?.pdfVerified === true && (state.stateChanged === true || state.completionVerified === true);
}

export function ensurePhotoInbox(pdfDir) {
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir,{recursive:true});
  const photoInbox = path.join(pdfDir,'1');
  const existed = fs.existsSync(photoInbox);
  if (existed && !fs.statSync(photoInbox).isDirectory()) throw new Error(`当天照片目录位置被同名文件占用：${photoInbox}`);
  if (!existed) fs.mkdirSync(photoInbox,{recursive:true});
  return { photoInbox, created:!existed };
}

export function markOnlineCompletionVerified(state, businessDate, checkedAt = new Date().toISOString()) {
  if (!state?.pdfVerified) throw new Error('PDF 尚未通过校验，不能补记线上完成状态。');
  if (state.pdfDate !== businessDate) throw new Error('PDF 校验状态与线上完成日期不一致。');
  return {
    ...state,
    completionVerified: true,
    completionSource: 'verified-pdf-and-online-zero-pending',
    completionVerifiedAt: checkedAt,
  };
}

export function evaluatePhotoOrderClosure({ missingBlessingCount = 0, onlineNotUploadedCount = 0, manualReviewCount = 0 } = {}) {
  const missingPhotos = Math.max(0,Number(missingBlessingCount || 0));
  const onlinePending = Math.max(0,Number(onlineNotUploadedCount || 0));
  const manualPending = Math.max(0,Number(manualReviewCount || 0));
  const complete = onlinePending === 0 && manualPending === 0;
  return {
    complete,
    partial: !complete,
    missingBlessingCount: missingPhotos,
    onlineNotUploadedCount: onlinePending,
    manualReviewCount: manualPending,
    stage: complete ? 'complete' : 'available-orders-complete-waiting-for-supplement',
  };
}

function orderIdHash(rows) {
  return crypto.createHash('sha256')
    .update(rows.map((row) => String(row.id)).sort().join('\n'))
    .digest('hex');
}

function verifyEmbeddedOrderManifest(manifest, businessDate, label) {
  if (!manifest || typeof manifest !== 'object') throw new Error(`PDF 凭据缺少${label}订单清单。`);
  if (manifest.businessDate !== businessDate) throw new Error(`${label}订单清单业务日期不一致。`);
  const rows = Array.isArray(manifest.rows) ? manifest.rows : [];
  const ids = rows.map((row) => String(row?.id || '').trim());
  if (ids.some((id) => !id)) throw new Error(`${label}订单清单包含空订单 ID。`);
  if (new Set(ids).size !== ids.length) throw new Error(`${label}订单清单包含重复订单 ID。`);
  if (Number(manifest.orderCount) !== rows.length || manifest.orderIdHash !== orderIdHash(rows)) {
    throw new Error(`${label}订单清单数量或哈希与 PDF 凭据不一致。`);
  }
  return rows;
}

export function resolvePdfBoundPhotoOrderScope({ businessDate, photoManifest, pdfReceipt } = {}) {
  if (!businessDate || !photoManifest || !pdfReceipt) {
    return { proven:false, reason:'missing-pdf-bound-order-evidence', rows:[], includeTablet:false };
  }
  if (photoManifest.businessDate !== businessDate || pdfReceipt.businessDate !== businessDate) {
    throw new Error('照片清单与 PDF 导出凭据的业务日期不一致。');
  }
  const photoPdfs = Array.isArray(photoManifest.pdfs) ? photoManifest.pdfs : [];
  const outputs = Array.isArray(pdfReceipt.outputs) ? pdfReceipt.outputs : [];
  if (!photoPdfs.length || !outputs.length || photoPdfs.length !== outputs.length) {
    return { proven:false, reason:'pdf-output-set-not-identical', rows:[], includeTablet:false };
  }
  const unmatchedOutputs = [...outputs];
  for (const pdf of photoPdfs) {
    const index = unmatchedOutputs.findIndex((output) => output?.sha256 === pdf?.sha256
      && Number(output?.pageCount) === Number(pdf?.pageCount));
    if (index < 0) return { proven:false, reason:'pdf-output-hash-not-bound', rows:[], includeTablet:false };
    unmatchedOutputs.splice(index,1);
  }
  if (unmatchedOutputs.length) return { proven:false, reason:'pdf-output-set-not-identical', rows:[], includeTablet:false };

  const lampRows = verifyEmbeddedOrderManifest(pdfReceipt.lamp,businessDate,'供灯');
  const tabletRows = verifyEmbeddedOrderManifest(pdfReceipt.tablet,businessDate,'牌位');
  const rows = [...lampRows,...tabletRows];
  const ids = rows.map((row) => String(row.id));
  if (!rows.length || new Set(ids).size !== ids.length) {
    return { proven:false, reason:rows.length ? 'cross-module-order-id-conflict' : 'empty-pdf-order-scope', rows:[], includeTablet:false };
  }
  if (Number(pdfReceipt.orderCount) !== rows.length || pdfReceipt.orderIdHash !== orderIdHash(rows)) {
    throw new Error('PDF 总订单清单数量或哈希与供灯/牌位分项不一致。');
  }
  return {
    proven:true,
    reason:'exact-pdf-output-hash-and-order-id-set',
    rows,
    includeTablet:tabletRows.length > 0,
    lampOrderCount:lampRows.length,
    tabletOrderCount:tabletRows.length,
    orderCount:rows.length,
    orderIdHash:pdfReceipt.orderIdHash,
  };
}

export function evaluatePhotoOnlineRecheck({
  onlineUploadedCount = 0,
  onlineNotUploadedCount = 0,
  pendingRegularCount = 0,
  pendingTabletCount = 0,
  historicalEvidenceProven = false,
} = {}) {
  const uploaded = Math.max(0, Number(onlineUploadedCount || 0));
  const notUploaded = Math.max(0, Number(onlineNotUploadedCount || 0));
  const regular = Math.max(0, Number(pendingRegularCount || 0));
  const tablet = Math.max(0, Number(pendingTabletCount || 0));
  const evidenceProven = historicalEvidenceProven === true;
  const onlinePendingCount = notUploaded + regular + tablet;
  const complete = evidenceProven && onlinePendingCount === 0;
  return {
    complete,
    onlineUploadedCount: uploaded,
    onlineNotUploadedCount: notUploaded,
    pendingRegularCount: regular,
    pendingTabletCount: tablet,
    onlinePendingCount,
    historicalEvidenceProven: evidenceProven,
    reason: !evidenceProven
      ? 'missing-historical-evidence'
      : onlinePendingCount > 0
        ? 'online-pending-remains'
        : 'online-zero-pending-verified',
  };
}

export function resolveHistoricalPhotoClosureEvidence({ historicalManifest = null, manifest = null } = {}) {
  const historicalOrderCount = Number(historicalManifest?.orderCount || 0);
  if (historicalOrderCount > 0) {
    return {
      proven: true,
      source: 'historical-order-manifest',
      historicalOrderCount,
      legacyPdfPageCount: 0,
    };
  }

  const counts = manifest?.counts || {};
  const blessingCount = Number(counts.blessing || 0);
  const pdfPageCount = Number(counts.pdfPages || 0);
  const blessingFiles = Array.isArray(manifest?.files?.blessing) ? manifest.files.blessing : [];
  const pdfFiles = Array.isArray(manifest?.pdfs) ? manifest.pdfs : [];
  const blockingErrors = Array.isArray(manifest?.blockingErrors) ? manifest.blockingErrors : [];
  const manualIssues = Array.isArray(manifest?.manualIssues) ? manifest.manualIssues : [];
  const hashes = manifest?.fileHashes && typeof manifest.fileHashes === 'object' ? manifest.fileHashes : {};
  const allBlessingFilesHashed = blessingFiles.length === blessingCount && blessingFiles.every((file) => Boolean(hashes[path.basename(file)]));
  const legacyPdfBacked = Boolean(manifest?.fileSetHash)
    && manifest?.blessingReady === true
    && manifest?.uploadReady === true
    && manifest?.batchCompleteReady === true
    && blessingCount > 0
    && pdfPageCount === blessingCount
    && Number(counts.missingBlessing || 0) === 0
    && Number(counts.extraBlessing || 0) === 0
    && pdfFiles.length > 0
    && blockingErrors.length === 0
    && manualIssues.length === 0
    && allBlessingFilesHashed;

  return {
    proven: legacyPdfBacked,
    source: legacyPdfBacked ? 'verified-legacy-pdf-photo-manifest' : 'none',
    historicalOrderCount: 0,
    legacyPdfPageCount: legacyPdfBacked ? pdfPageCount : 0,
  };
}

export function upsertPhotoCompletionBatch(batches, batch) {
  if (!batch?.fileSetHash) throw new Error('照片订单分批完成回执缺少图片集合哈希。');
  const result = Array.isArray(batches) ? batches.filter((item) => item?.fileSetHash !== batch.fileSetHash) : [];
  result.push(batch);
  return result;
}

export async function loadVerifiedPdfWorkflow(runDir, pdfDir, businessDate) {
  const stateFile = path.join(runDir, 'run-state.json');
  const receiptFile = path.join(runDir, 'pdf-receipt.json');
  const state = readJson(stateFile, 'PDF 校验状态');
  const receipt = readJson(receiptFile, 'PDF 导出凭据');
  if (state.pdfDate !== businessDate || receipt.businessDate !== businessDate) throw new Error('已有 PDF 的业务日期与当前选择日期不一致。');
  if (!state.pdfVerified) throw new Error('已有 PDF 尚无完整校验凭据，不能直接修改状态。');
  if (!state.orderIdHash || state.orderIdHash !== receipt.orderIdHash || state.orderCount !== receipt.orderCount) throw new Error('PDF 校验状态与导出订单清单不一致。');
  if (state.lamp || state.tablet || receipt.lamp || receipt.tablet) {
    for (const key of ['lamp','tablet']) {
      if (!state[key] || !receipt[key] || state[key].orderIdHash !== receipt[key].orderIdHash || state[key].orderCount !== receipt[key].orderCount) {
        throw new Error(`PDF 校验状态与${key === 'lamp' ? '供灯' : '牌位'}订单清单不一致。`);
      }
    }
  }
  if (!Array.isArray(receipt.outputs) || !receipt.outputs.length) throw new Error('PDF 导出凭据中没有最终文件。');

  const verifiedOutputs = [];
  const seen = new Set();
  for (const output of receipt.outputs) {
    const original = String(output.file || '');
    const candidate = fs.existsSync(original) ? original : path.join(pdfDir, path.basename(original));
    if (!fs.existsSync(candidate)) throw new Error(`已有 PDF 缺失：${path.basename(original)}`);
    const key = path.resolve(candidate).toLowerCase();
    if (seen.has(key)) throw new Error(`PDF 导出凭据包含重复文件：${path.basename(candidate)}`);
    seen.add(key);
    const verified = await verifyPdf(candidate);
    if (verified.bytes !== output.bytes || verified.pageCount !== output.pageCount || verified.sha256 !== output.sha256) {
      throw new Error(`已有 PDF 与原校验凭据不一致：${path.basename(candidate)}`);
    }
    verifiedOutputs.push(verified);
  }
  return { state, receipt, verifiedOutputs, stateFile };
}
