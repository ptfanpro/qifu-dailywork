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
