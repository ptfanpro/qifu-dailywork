import fs from 'node:fs';
import path from 'node:path';
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
