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

export function evaluatePhotoOrderClosure({ missingBlessingCount = 0, onlineNotUploadedCount = null, manualReviewCount = 0, completedOrderCount = 0 } = {}) {
  const missingPhotos = Math.max(0,Number(missingBlessingCount || 0));
  const onlineVerified = Number.isFinite(onlineNotUploadedCount) && onlineNotUploadedCount >= 0;
  const onlinePending = onlineVerified ? onlineNotUploadedCount : null;
  const manualPending = Math.max(0,Number(manualReviewCount || 0));
  const complete = onlineVerified && onlinePending === 0 && manualPending === 0 && Number(completedOrderCount) > 0;
  return {
    complete,
    partial: !complete,
    missingBlessingCount: missingPhotos,
    onlineNotUploadedCount: onlinePending,
    manualReviewCount: manualPending,
    stage: complete ? 'complete' : onlineVerified ? 'available-orders-complete-waiting-for-supplement' : 'online-verification-required',
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
  onlineScopeCount = null,
  onlineUnfinishedCount = null,
} = {}) {
  const uploaded = Math.max(0, Number(onlineUploadedCount || 0));
  const notUploaded = Math.max(0, Number(onlineNotUploadedCount || 0));
  const regular = Math.max(0, Number(pendingRegularCount || 0));
  const tablet = Math.max(0, Number(pendingTabletCount || 0));
  const evidenceProven = historicalEvidenceProven === true;
  const onlinePendingCount = notUploaded + regular + tablet;
  const scopeVerified = Number.isFinite(onlineScopeCount) && onlineScopeCount > 0;
  const unfinishedVerified = Number.isFinite(onlineUnfinishedCount) && onlineUnfinishedCount >= 0;
  const complete = evidenceProven && scopeVerified && unfinishedVerified && onlineUnfinishedCount === 0 && onlinePendingCount === 0;
  return {
    complete,
    onlineUploadedCount: uploaded,
    onlineNotUploadedCount: notUploaded,
    pendingRegularCount: regular,
    pendingTabletCount: tablet,
    onlinePendingCount,
    onlineScopeCount: scopeVerified ? onlineScopeCount : 0,
    onlineUnfinishedCount: unfinishedVerified ? onlineUnfinishedCount : null,
    historicalEvidenceProven: evidenceProven,
    reason: !evidenceProven
      ? 'missing-historical-evidence'
      : !scopeVerified || !unfinishedVerified
        ? 'online-scope-unverified'
        : onlineUnfinishedCount > 0
          ? 'online-orders-unfinished'
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

export function decideManualPhotoResume({
  blessingCount = 0,
  verifiedReceiptCount = 0,
  pendingFiles = [],
  uncertainSubmission = false,
  onlineUploadedCount = 0,
  onlinePendingRows = [],
} = {}) {
  const filenames = Array.isArray(pendingFiles) ? pendingFiles.map((file) => path.basename(String(file))) : [];
  const orderKeys = Array.isArray(onlinePendingRows)
    ? onlinePendingRows.map((row) => `${row?.kind}:${String(row?.id || '')}`) : [];
  const safe = Number.isInteger(blessingCount) && blessingCount > 0
    && Number.isInteger(verifiedReceiptCount) && verifiedReceiptCount >= 0
    && filenames.length > 0 && verifiedReceiptCount + filenames.length === blessingCount
    && filenames.every(Boolean) && new Set(filenames).size === filenames.length
    && !uncertainSubmission
    && Number.isInteger(onlineUploadedCount) && onlineUploadedCount >= 0
    && (verifiedReceiptCount === 0 ? onlineUploadedCount === 0 : onlineUploadedCount > 0)
    && Array.isArray(onlinePendingRows) && onlinePendingRows.length > 0
    && onlinePendingRows.every((row) => String(row?.id || '').length > 0 && ['lamp','tablet'].includes(row?.kind))
    && new Set(orderKeys).size === orderKeys.length;
  return safe
    ? { allowed:true, pendingFiles:filenames, pendingOrderRows:onlinePendingRows.map((row) => ({ id:String(row.id),kind:row.kind })) }
    : { allowed:false };
}

const manualUploadSubmissionStages=new Set([
  'month-submit-started','submitting','month-submitted','upload-confirmed',
  'transport-request','transport-response','transport-outcome','transport-receipt',
  'upload-receipt','upload-reconciled',
]);
const manualUploadPreparationStages=new Set([
  'manual-photo-one-time-retry-ready','manual-photo-resume-ready','starting',
  'staging-local-upload-cache','filechooser-armed','selecting-files','files-selected',
]);
const manualUploadUncertainRetryStages=new Set([
  'month-submit-started','submitting','month-submitted','upload-confirmed',
  'transport-request','transport-response','transport-outcome',
]);

export function retainManualPhotoAttemptEvidence(previous) {
  if (previous?.uncertainSubmission !== true) return null;
  const older=previous.previousAttempt || {};
  const currentFiles=Array.isArray(previous.currentBatchFiles) ? previous.currentBatchFiles : [];
  const currentWasSubmitted=currentFiles.length>0 && (
    manualUploadSubmissionStages.has(previous.stage)
    || manualUploadSubmissionStages.has(previous.currentBatchSubmissionStage)
    || previous.currentBatchTransportRequestSeen===true
    || previous.currentBatchTransportResponseSeen===true
    || previous.currentBatchUploadEvidence?.requestStarted===true
    || previous.currentBatchUploadEvidence?.responseSeen===true
    || previous.currentBatchUploadCount != null
  );
  if (currentWasSubmitted) {
    // Keep one submission's identity together. In particular, an absent new
    // count is not the older batch's successful numeric receipt, and a recent
    // retry must not inherit the first attempt's already-expired waiting time.
    return {
      stage:previous.currentBatchSubmissionStage || previous.stage || null,
      files:[...currentFiles],
      startedAt:previous.currentBatchStartedAt || null,
      pendingOrderIdHash:Object.hasOwn(previous,'currentBatchPendingOrderIdHash')
        ? previous.currentBatchPendingOrderIdHash ?? null : previous.pendingOrderIdHash ?? null,
      pendingOrderCount:Object.hasOwn(previous,'currentBatchPendingOrderCount')
        ? previous.currentBatchPendingOrderCount ?? null : previous.pendingOrderCount ?? null,
      uploadedCount:previous.currentBatchUploadCount ?? null,
    };
  }
  return {
    stage:older.stage || previous.stage || null,
    files:Array.isArray(older.files) && older.files.length ? older.files
      : currentFiles,
    startedAt:older.startedAt || previous.currentBatchStartedAt || previous.startedAt || null,
    pendingOrderIdHash:older.pendingOrderIdHash || previous.pendingOrderIdHash || null,
    pendingOrderCount:older.pendingOrderCount ?? previous.pendingOrderCount ?? null,
    uploadedCount:previous.currentBatchUploadCount ?? older.uploadedCount ?? null,
  };
}

export function restoreUnusedManualUploadRetryCount(previous) {
  const count=Number(previous?.uncertainRetryCount || 0);
  const retry=previous?.uncertainRetryEvidence;
  // Persisting the boundary precedes the browser click. A crash between them
  // is deliberately uncertain; absence of network observations cannot undo it.
  if (retry?.status==='possibly-submitted') return Math.max(1,count);
  if (count!==1 || !retry?.originalAttempt) return count;
  const evidence=previous?.currentBatchUploadEvidence;
  const noNetworkObserved=(evidence?.requestStarted===false && evidence?.responseSeen===false)
    || (previous?.currentBatchTransportRequestSeen===false && previous?.currentBatchTransportResponseSeen===false);
  const submissionEvidence=manualUploadSubmissionStages.has(previous?.stage)
    || Boolean(previous?.currentBatchSubmissionStage)
    || previous?.currentBatchTransportRequestSeen===true || previous?.currentBatchTransportResponseSeen===true
    || previous?.currentBatchTransportStatus != null || previous?.currentBatchTransportOutcome != null
    || previous?.currentBatchUploadCount != null
    || evidence?.requestStarted===true || evidence?.responseSeen===true
    || evidence?.applicationSuccess===true || evidence?.applicationFailure===true
    || (Array.isArray(evidence?.responseStatuses) && evidence.responseStatuses.length>0)
    || (Array.isArray(evidence?.responseOutcomes) && evidence.responseOutcomes.length>0);
  const knownPreparation=retry.status==='reserved' || manualUploadPreparationStages.has(previous?.stage);
  return knownPreparation && noNetworkObserved && !submissionEvidence ? 0 : count;
}

export function retainManualUploadRetryState(previous) {
  const retained={uncertainRetryCount:restoreUnusedManualUploadRetryCount(previous)};
  // Keep one attempt's diagnostics and identity together through read-only
  // restarts, including restarts which stop before a new batch is prepared.
  for (const key of ['uncertainRetryEvidence','currentBatch','currentBatchFiles','currentBatchStartedAt',
    'currentBatchPendingOrderIdHash','currentBatchPendingOrderCount','currentBatchSubmissionStage',
    'currentBatchTransportRequestSeen','currentBatchTransportResponseSeen','currentBatchTransportStatus',
    'currentBatchTransportOutcome','currentBatchUploadCount','currentBatchUploadEvidence','currentBatchCompletedAt']) {
    if (previous && Object.hasOwn(previous,key)) retained[key]=structuredClone(previous[key]);
  }
  // Legacy receipts scoped the current batch at the top level. Promote that
  // scope once so repeated restarts cannot reconstruct an unbound attempt.
  // An explicit per-batch null belongs to a fresh batch and must stay null.
  if (Array.isArray(previous?.currentBatchFiles) && previous.currentBatchFiles.length) {
    for (const [batchKey,legacyKey] of [['currentBatchPendingOrderIdHash','pendingOrderIdHash'],
      ['currentBatchPendingOrderCount','pendingOrderCount']]) {
      if (!Object.hasOwn(previous,batchKey) && Object.hasOwn(previous,legacyKey)) {
        retained[batchKey]=structuredClone(previous[legacyKey] ?? null);
      }
    }
  }
  return retained;
}

export function reserveManualUploadRetry(receipt,recovery,{now=new Date().toISOString()}={}) {
  if (!receipt?.previousAttempt || recovery?.allowed!==true || restoreUnusedManualUploadRetryCount(receipt)!==0) {
    throw new Error('当前凭据不允许预留人工编号照片重试。');
  }
  receipt.uncertainRetryCount=0;
  receipt.uncertainRetryEvidence={
    status:'reserved',checkedAt:now,pendingOrderCount:recovery.pendingOrderRows.length,
    pendingOrderIdHash:recovery.pendingOrderIdHash,
    originalAttempt:structuredClone(receipt.previousAttempt),
  };
  return receipt.uncertainRetryEvidence;
}

export function markManualUploadRetrySubmitted(receipt,stage) {
  const retry=receipt?.uncertainRetryEvidence;
  if (!retry?.originalAttempt || !manualUploadSubmissionStages.has(stage)) return false;
  const first=retry.status!=='possibly-submitted';
  receipt.uncertainRetryCount=Math.max(1,Number(receipt.uncertainRetryCount || 0));
  retry.status='possibly-submitted';
  if (first) retry.submissionStage=stage;
  return first;
}

export function decideManualPhotoUncertainRetry({
  blessingCount = 0, verifiedReceiptCount = 0, pendingFiles = [],
  previousAttempt = null, uncertainRetryCount = 0,
  onlineUploadedCount = 0, secondOnlineUploadedCount = 0,
  firstPendingRows = [], secondPendingRows = [], now = new Date().toISOString(),
} = {}) {
  const rejected = { allowed:false };
  const filenames = Array.isArray(pendingFiles) ? pendingFiles.map((file) => path.basename(String(file))) : [];
  const attemptFiles = Array.isArray(previousAttempt?.files) ? previousAttempt.files : [];
  const age = Date.parse(now) - Date.parse(previousAttempt?.startedAt || '');
  if (!Number.isInteger(blessingCount) || blessingCount <= 0 || verifiedReceiptCount !== 0
    || filenames.length !== blessingCount || new Set(filenames).size !== filenames.length
    || attemptFiles.length !== filenames.length || !attemptFiles.every((name) => filenames.includes(name))
    || !manualUploadUncertainRetryStages.has(previousAttempt?.stage)
    || previousAttempt?.uploadedCount != null || uncertainRetryCount !== 0
    || !Number.isFinite(age) || age < 15 * 60 * 1000
    || onlineUploadedCount !== 0 || secondOnlineUploadedCount !== 0) return rejected;
  const keys = (rows) => Array.isArray(rows) ? rows.map((row) =>
    ['lamp','tablet'].includes(row?.kind) && String(row?.id || '') ? `${row.kind}:${row.id}` : '') : [];
  const first = keys(firstPendingRows);
  const second = keys(secondPendingRows);
  first.sort();
  second.sort();
  if (!first.length || first.includes('') || second.includes('')
    || new Set(first).size !== first.length || new Set(second).size !== second.length
    || first.length !== second.length || first.some((key,index) => key !== second[index])) return rejected;
  const pendingOrderIdHash = crypto.createHash('sha256').update(first.join('\n')).digest('hex');
  if (previousAttempt?.pendingOrderIdHash && previousAttempt.pendingOrderIdHash !== pendingOrderIdHash) return rejected;
  return {allowed:true,pendingFiles:filenames,
    pendingOrderRows:secondPendingRows.map((row) => ({id:String(row.id),kind:row.kind})),
    pendingOrderIdHash};
}

export function manualPhotoUploadProgress(beforePendingRows, afterUploadedRows, afterPendingRows) {
  const failure = { confirmed:false, movedCount:0, remainingRows:[] };
  if (!Array.isArray(beforePendingRows) || !Array.isArray(afterUploadedRows) || !Array.isArray(afterPendingRows)) return failure;
  const key = (row) => `${row?.kind}:${String(row?.id || '')}`;
  const valid = (row) => String(row?.id || '').length > 0 && ['lamp','tablet'].includes(row?.kind);
  if (!beforePendingRows.length || ![...beforePendingRows,...afterUploadedRows,...afterPendingRows].every(valid)) return failure;
  const beforeKeys = beforePendingRows.map(key);
  const uploadedKeys = afterUploadedRows.map(key);
  const pendingKeys = afterPendingRows.map(key);
  if (new Set(beforeKeys).size !== beforeKeys.length
    || new Set(uploadedKeys).size !== uploadedKeys.length
    || new Set(pendingKeys).size !== pendingKeys.length) return failure;
  const uploaded = new Set(uploadedKeys);
  const pending = new Set(pendingKeys);
  if (beforeKeys.some((item) => uploaded.has(item) === pending.has(item))) return failure;
  const movedCount = beforeKeys.filter((item) => uploaded.has(item)).length;
  return movedCount > 0
    ? { confirmed:true, movedCount, remainingRows:afterPendingRows.map((row) => ({ id:String(row.id),kind:row.kind })) }
    : failure;
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
