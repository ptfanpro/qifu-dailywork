import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {retainManualPhotoAttemptEvidence} from './workflow-state.mjs';

const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validHash=value=>typeof value==='string' && /^[a-f0-9]{64}$/i.test(value);
const validDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0,10)===value;
const safeName=name=>typeof name==='string' && /^\d+\.jpg$/i.test(name)
  && Number.isSafeInteger(Number(name.slice(0,-4))) && Number(name.slice(0,-4))>0;
const safeNames=names=>Array.isArray(names) && names.length>0 && names.every(safeName)
  && new Set(names.map(name=>name.toLowerCase())).size===names.length;
const submittedStages=new Set(['month-submit-started','submitting','month-submitted','upload-confirmed',
  'transport-request','transport-response','transport-outcome','transport-receipt','upload-receipt','upload-reconciled']);
const uncertainStages=new Set(['month-submit-started','submitting','month-submitted','upload-confirmed',
  'transport-request','transport-response','transport-outcome']);
const normalizedHashes=(names,hashes)=>Object.fromEntries([...names].sort().map(name=>[name,String(hashes[name]).toLowerCase()]));
const refused=reason=>({eligible:false,reason});
const hasReceipts=receipt=>Number(receipt?.uploadedCount || 0)!==0
  || Object.keys(receipt?.uploadedFiles || {}).length>0
  || !Array.isArray(receipt?.batches || [])
  || (receipt?.batches || []).some(batch=>batch?.uploadedCount != null);
const attemptIdentity=attempt=>{
  if (!attempt) return attempt;
  const {fileHashes,...identity}=attempt;
  return identity;
};

function fixedPriorReceipt(receipt) {
  const active=receipt?.correctedAttempts?.[receipt?.activeCorrectionId];
  if (!active) return receipt;
  return active.status==='approved' ? active.oldReceipt : null;
}

export function manualCorrectionPreparationHashes({preparationReceipt,businessDate,attemptFiles,attemptStartedAt}) {
  if (!validDate(businessDate) || preparationReceipt?.businessDate!==businessDate || !safeNames(attemptFiles)
    || !Array.isArray(preparationReceipt?.files)
    || !Number.isFinite(Date.parse(preparationReceipt?.completedAt))
    || !Number.isFinite(Date.parse(attemptStartedAt))
    || Date.parse(preparationReceipt.completedAt)>Date.parse(attemptStartedAt)) return null;
  const hashes={};
  for (const item of preparationReceipt.files || []) {
    if (!attemptFiles.includes(item?.targetName)) continue;
    if (item.kind!=='blessing' || !validHash(item.afterSha256)) return null;
    const value=item.afterSha256.toLowerCase();
    if (hashes[item.targetName] && hashes[item.targetName]!==value) return null;
    hashes[item.targetName]=value;
  }
  return hashes;
}

// Read only the caller's local receipt. Never follow source/target/backup paths
// inside it or read customer photos to reconstruct an old submitted batch.
export function readManualCorrectionPreparationHashes({file,...options}) {
  if (typeof file!=='string' || /^(?:\\\\|\/\/)/.test(file) || !path.isAbsolute(file)) {
    throw new Error('修正审核只允许读取本机压缩回执文件。');
  }
  const resolved=fs.realpathSync.native(file);
  if (/^(?:\\\\|\/\/)/.test(resolved)) throw new Error('修正审核不能从网络共享读取历史压缩回执。');
  return manualCorrectionPreparationHashes({...options,preparationReceipt:JSON.parse(fs.readFileSync(resolved,'utf8').replace(/^\uFEFF/,''))});
}

function pendingScope(snapshot) {
  if (snapshot?.uploadedCount!==0 || !Array.isArray(snapshot.pendingRows) || !snapshot.pendingRows.length) return null;
  const keys=snapshot.pendingRows.map(row=>['lamp','tablet'].includes(row?.kind)
    && typeof row.id==='string' && row.id && !/[\r\n]/.test(row.id) ? `${row.kind}:${row.id}` : null);
  if (keys.includes(null) || new Set(keys).size!==keys.length) return null;
  return {hash:crypto.createHash('sha256').update(keys.sort().join('\n')).digest('hex'),count:keys.length};
}

function binding(review) {
  return {schemaVersion:1,kind:'duplicate-content-correction',businessDate:review.businessDate,
    oldAttempt:review.oldAttempt,oldUncertainRetryCount:review.oldUncertainRetryCount,
    oldFileHashes:review.oldFileHashes,currentFiles:review.currentFiles,currentFileHashes:review.currentFileHashes,
    removedFiles:review.removedFiles,
    pendingOrderIdHash:review.pendingOrderIdHash,pendingOrderCount:review.pendingOrderCount};
}

export function prepareManualUploadCorrectionReview({businessDate,receipt,currentFiles,currentFileHashes,
  preparationReceipt=null,firstOnline,secondOnline,now=new Date().toISOString()}={}) {
  if (!validDate(businessDate) || receipt?.businessDate!==businessDate) return refused('business-date-mismatch');
  const prior=fixedPriorReceipt(receipt);
  if (!prior) return refused('correction-already-submitted');
  if (prior.businessDate!==businessDate || prior.complete===true || prior.uncertainSubmission!==true
    || hasReceipts(prior) || hasReceipts(receipt)) return refused('prior-upload-evidence-conflict');
  const attempt=retainManualPhotoAttemptEvidence(prior);
  if (!attempt || !uncertainStages.has(attempt.stage) || attempt.uploadedCount != null
    || prior.currentBatchUploadCount != null || !safeNames(attempt.files)) return refused('old-attempt-incomplete');
  const age=Date.parse(now)-Date.parse(attempt.startedAt);
  if (!Number.isFinite(age) || age<15*60*1000) return refused('old-attempt-too-recent');
  if (!safeNames(currentFiles) || currentFiles.length>50 || currentFiles.length>=attempt.files.length
    || currentFiles.some(name=>!attempt.files.includes(name))) return refused('current-batch-is-not-a-proper-subset');
  if (currentFiles.some(name=>!validHash(currentFileHashes?.[name]))) return refused('current-file-hashes-incomplete');
  const currentHashes=normalizedHashes(currentFiles,currentFileHashes);
  if (new Set(Object.values(currentHashes)).size!==currentFiles.length) return refused('current-batch-still-has-duplicates');
  const approved=receipt.correctedAttempts?.[receipt.activeCorrectionId];
  if (approved && (approved.review?.correctionId!==receipt.activeCorrectionId
    || approved.review.correctionId!==digest(binding(approved.review))
    || digest(attemptIdentity(attempt))!==digest(approved.review.oldAttempt)
    || Number(prior.uncertainRetryCount || 0)!==approved.review.oldUncertainRetryCount)) {
    return refused('approved-correction-evidence-changed');
  }
  const directHashes=approved?.status==='approved' ? approved.review.oldFileHashes : attempt.fileHashes || {};
  if (attempt.files.some(name=>directHashes[name]!=null && !validHash(directHashes[name]))) return refused('old-file-hashes-invalid');
  const hasDirectHashes=attempt.files.every(name=>validHash(directHashes[name]));
  const prepared=!hasDirectHashes && preparationReceipt ? manualCorrectionPreparationHashes({preparationReceipt,businessDate,
    attemptFiles:attempt.files,attemptStartedAt:attempt.startedAt}) : {};
  if (prepared===null) return refused('historical-preparation-conflict');
  const oldHashes={};
  for (const name of attempt.files) {
    const direct=directHashes[name];
    if (direct && prepared[name] && direct.toLowerCase()!==prepared[name]) return refused('old-file-hashes-conflict');
    oldHashes[name]=direct?.toLowerCase() || prepared[name];
    if (!validHash(oldHashes[name])) return refused('old-file-hashes-incomplete');
  }
  if (currentFiles.some(name=>oldHashes[name]!==currentHashes[name])) return refused('retained-file-content-changed');
  const removedFiles=[];
  for (const name of attempt.files.filter(name=>!currentFiles.includes(name))) {
    const matches=currentFiles.filter(retained=>oldHashes[name]===currentHashes[retained]);
    if (matches.length!==1) return refused('removed-file-not-an-exact-duplicate');
    removedFiles.push({name,duplicateOf:matches[0],sha256:oldHashes[name]});
  }
  const first=pendingScope(firstOnline),second=pendingScope(secondOnline);
  if (!first || !second || first.hash!==second.hash || first.count!==second.count
    || !validHash(attempt.pendingOrderIdHash) || first.hash!==attempt.pendingOrderIdHash
    || first.count!==attempt.pendingOrderCount) return refused('online-order-scope-changed');
  const review={eligible:true,schemaVersion:1,kind:'duplicate-content-correction',businessDate,createdAt:now,
    warning:'上次提交的最终结果仍不明确。以下重复内容已从当前批次移除；只有人工确认后，才允许将修正批次提交一次。',
    oldAttempt:structuredClone(attemptIdentity(attempt)),oldUncertainRetryCount:Number(prior.uncertainRetryCount || 0),
    oldFileHashes:normalizedHashes(attempt.files,oldHashes),currentFiles:[...currentFiles].sort(),
    currentFileHashes:currentHashes,removedFiles:removedFiles.sort((a,b)=>a.name.localeCompare(b.name)),
    pendingOrderIdHash:first.hash,pendingOrderCount:first.count};
  review.correctionId=digest(binding(review));
  review.confirmationToken=digest({kind:'confirm-duplicate-content-correction',correctionId:review.correctionId});
  const existing=receipt.correctedAttempts?.[review.correctionId];
  if (existing && existing.status!=='approved') return refused('correction-already-submitted');
  return review;
}

export function approveManualUploadCorrection(receipt,review,{confirmationToken,confirmed=false,now=new Date().toISOString()}={}) {
  const prior=fixedPriorReceipt(receipt);
  const age=Date.parse(now)-Date.parse(review?.createdAt);
  if (confirmed!==true || review?.eligible!==true || review.businessDate!==receipt?.businessDate
    || review.correctionId!==digest(binding(review))
    || confirmationToken!==review.confirmationToken
    || confirmationToken!==digest({kind:'confirm-duplicate-content-correction',correctionId:review.correctionId})
    || !Number.isFinite(age) || age<0 || age>10*60*1000 || !prior
    || digest(attemptIdentity(retainManualPhotoAttemptEvidence(prior)))!==digest(review.oldAttempt)
    || Number(prior.uncertainRetryCount || 0)!==review.oldUncertainRetryCount
    || hasReceipts(receipt) || hasReceipts(prior)) throw new Error('修正批次审核已变化或缺少本次人工确认，未授权上传。');
  const existing=receipt.correctedAttempts?.[review.correctionId];
  if (existing) {
    if (existing.status!=='approved') throw new Error('此修正批次已进入提交阶段，不能再次授权。');
    receipt.activeCorrectionId=review.correctionId;
    return existing;
  }
  const oldReceipt=structuredClone(prior);
  delete oldReceipt.correctedAttempts;
  delete oldReceipt.activeCorrectionId;
  const correction={schemaVersion:1,correctionId:review.correctionId,status:'approved',approvedAt:now,
    review:structuredClone(review),oldReceipt,submissionStage:null};
  receipt.correctedAttempts={...(receipt.correctedAttempts || {}),[review.correctionId]:correction};
  receipt.activeCorrectionId=review.correctionId;
  return correction;
}

export function markManualUploadCorrectionSubmitted(receipt,correctionId,stage,{now=new Date().toISOString()}={}) {
  if (!submittedStages.has(stage)) return false;
  const correction=receipt?.correctedAttempts?.[correctionId];
  if (!correction || receipt.activeCorrectionId!==correctionId) throw new Error('没有匹配的人工修正授权。');
  if (correction.status==='submitting') return false;
  if (correction.status!=='approved') throw new Error('此修正批次不能再次提交。');
  correction.status='submitting';
  correction.submissionStage=stage;
  correction.submittedAt=now;
  return true;
}

export function confirmManualUploadCorrection(receipt,correctionId,{uploadedFileHashes,now=new Date().toISOString()}={}) {
  const correction=receipt?.correctedAttempts?.[correctionId];
  if (!correction || !['submitting','confirmed'].includes(correction.status)
    || Object.entries(correction.review.currentFileHashes).some(([name,sha])=>uploadedFileHashes?.[name]!==sha)) {
    throw new Error('修正批次缺少完整逐文件上传凭据，不能标记完成。');
  }
  correction.status='confirmed';
  correction.confirmedAt=correction.confirmedAt || now;
  return correction;
}

export function finalizeManualUploadCorrection(receipt,{now=new Date().toISOString()}={}) {
  const id=receipt?.activeCorrectionId;
  if (!id) return false;
  const correction=receipt.correctedAttempts?.[id];
  const expected=correction?.review?.currentFileHashes;
  if (!correction || !['approved','submitting','confirmed'].includes(correction.status)
    || !expected || !Object.keys(expected).length
    || Object.entries(expected).some(([name,hash])=>receipt.uploadedFiles?.[name]?.sha256!==hash)) {
    throw new Error('修正批次缺少完整逐文件上传凭据，不能结束审核。');
  }
  if (correction.status==='approved') {
    if (correction.submittedAt || correction.submissionStage) throw new Error('修正批次提交记录矛盾，不能结束审核。');
    // A read-only online reconciliation may prove that the old upload did
    // succeed before the approved correction is ever submitted. Close the
    // review without inventing a POST or a receipt for the removed duplicate.
    correction.status='confirmed';
    correction.confirmedAt=now;
    correction.evidence='resolved-by-existing-receipts';
  } else {
    confirmManualUploadCorrection(receipt,id,{now,uploadedFileHashes:Object.fromEntries(
      Object.entries(receipt.uploadedFiles || {}).map(([name,item])=>[name,item.sha256]))});
    correction.evidence=correction.evidence || 'verified-upload-receipts';
  }
  receipt.activeCorrectionId=null;
  return true;
}

export function retainManualUploadCorrectionState(receipt) {
  return {correctedAttempts:structuredClone(receipt?.correctedAttempts || {}),
    activeCorrectionId:receipt?.activeCorrectionId || null};
}

export function hasPendingManualUploadCorrection(receipt) {
  if (receipt?.activeCorrectionId
    && !['approved','confirmed'].includes(receipt.correctedAttempts?.[receipt.activeCorrectionId]?.status)) return true;
  // A lost active pointer cannot turn a persisted submission back into an
  // ordinary retry. Only an explicit confirmed outcome releases this guard.
  return Object.values(receipt?.correctedAttempts || {}).some(correction=>
    !['approved','confirmed'].includes(correction?.status));
}
