import path from 'node:path';
import {reconcileManualUploadedPhotos} from './manual-upload-reconciliation.mjs';

// An upload without a numeric receipt is uncertain, not a failed submission.
// Recover from the same date's actual pictures within this click, without POSTing again.
export async function uploadManualBatchWithRecovery({
  site, date, files, allFiles, fileHashes, onStage = () => {},
  onMatch = async () => {}, onReconciliation = async () => {},
}) {
  try {
    return await site.uploadBlessingBatch(files, date, onStage);
  } catch (error) {
    if (error?.code !== 'BLESSING_UPLOAD_OUTCOME_UNCONFIRMED') throw error;
    await onReconciliation(error);
    const readback = await reconcileManualUploadedPhotos({site,date,files,allFiles,fileHashes,onMatch});
    if (readback.missingNames.length) {
      const stopped = new Error(`上传后的线上图片核对尚未完成：本批 ${files.length} 张，已确认 ${readback.matched.length} 张，仍需核对 ${readback.missingNames.join('、')}。已保存确认结果，没有再次上传；再次点击将先核对线上照片。`);
      stopped.code = 'MANUAL_UPLOAD_READBACK_INCOMPLETE';
      stopped.uploadEvidence = error.uploadEvidence;
      stopped.readback = readback;
      throw stopped;
    }
    onStage('upload-reconciled',{uploadedCount:files.length});
    return {
      uploadedCount:files.length, month:date.slice(0,7).replace('-',''),
      files:files.map(file=>path.basename(file)), evidence:'online-image-readback',
      readbackScannedImageCount:readback.scanned,
    };
  }
}

// A scene-picture change must not erase an unresolved blessing-photo POST.
// Reconcile old attempts before considering any new batch or retry budget.
export function needsManualUploadRecovery(previous) {
  return Boolean(previous && previous.complete !== true);
}

export function manualAttemptFilesVerified(receipt, fileHashes) {
  const files=receipt?.currentBatchFiles?.length ? receipt.currentBatchFiles : receipt?.previousAttempt?.files;
  return Array.isArray(files) && files.length > 0 && new Set(files).size===files.length
    && files.every(name=>fileHashes?.[name] && receipt.uploadedFiles?.[name]?.sha256===fileHashes[name]);
}

export function assertManualAttemptResolved(receipt, fileHashes) {
  if (!receipt?.uncertainSubmission || manualAttemptFilesVerified(receipt,fileHashes)) return;
  const files=receipt?.currentBatchFiles?.length ? receipt.currentBatchFiles : receipt?.previousAttempt?.files || [];
  const missing=files.filter(name=>!fileHashes?.[name] || receipt.uploadedFiles?.[name]?.sha256!==fileHashes[name]);
  const error=new Error(`上次提交仍有照片未确认${missing.length?`：${missing.join('、')}`:''}。请保留原批次照片以便核对；当前目录的部分文件合格不能清除其余照片的提交记录。没有再次上传。`);
  error.code='MANUAL_UPLOAD_PREVIOUS_ATTEMPT_UNRESOLVED';
  throw error;
}
