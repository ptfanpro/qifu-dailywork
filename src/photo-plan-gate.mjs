import path from 'node:path';
import {assertPhotoReviewIsolation} from './photo-review-isolation.mjs';
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const validName=value=>typeof value==='string'&&value.length>0&&!/[\\/:]/.test(value)&&!['.','..'].includes(value);
const key=name=>name.toLowerCase();
const pathKey=file=>path.resolve(file).toLowerCase();
const standardized=name=>/^(?:\d+|2\.[1256])\.(?:jpe?g|png)$/i.test(name);

// Bind reviewed source bytes or the exact preparation transformation receipt.
// A cached PDF index alone cannot prove the identity of a same-named photo.
function reviewedPhotoHashes(plan,receipt) {
  if(plan?.photoInputBinding?.schemaVersion!==1||!Array.isArray(plan.photoInputBinding.files))return null;
  const originals=new Map();
  for(const file of plan.photoInputBinding.files) {
    if(!validName(file.name)||!validHash(file.sha256)||originals.has(key(file.name)))return null;
    originals.set(key(file.name),file.sha256);
  }
  const assignments=plan.assignments||[],standardizations=plan.unresolvedStandardizations||[],duplicates=plan.duplicateSources||[];
  if(!Array.isArray(assignments)||!Array.isArray(standardizations)||!Array.isArray(duplicates))return null;
  const before=new Map(originals);
  // A numeric source awaiting renumbering is not eligible under its old name.
  for(const item of [...assignments,...standardizations]) {
    if(typeof item.source!=='string'||!validName(item.targetName))return null;
    if(key(path.basename(item.source))!==key(item.targetName))before.delete(key(path.basename(item.source)));
  }
  if(!receipt)return before;
  const plannedAt=Date.parse(plan.createdAt),completedAt=Date.parse(receipt.completedAt);
  if(!Number.isFinite(plannedAt)||!Number.isFinite(completedAt)||completedAt<plannedAt
    ||receipt.businessDate!==plan.businessDate||!Array.isArray(receipt.files)
    ||receipt.files.length!==assignments.length||!Array.isArray(receipt.duplicates)
    ||receipt.duplicates.length!==duplicates.length
    ||!Array.isArray(receipt.standardizedUnresolvedFiles||[])
    ||(receipt.standardizedUnresolvedFiles||[]).length!==standardizations.length
    ||typeof plan.photoDir!=='string')return before;
  const moved=new Set(),targets=new Map();
  for(const [items,records,group] of [
    [assignments,receipt.files,'assigned'],
    [standardizations,receipt.standardizedUnresolvedFiles||[],'unresolved'],
    [duplicates,receipt.duplicates,'duplicate'],
  ]) {
    for(const item of items) {
      if(typeof item.source!=='string'||pathKey(path.dirname(item.source))!==pathKey(plan.photoDir))return before;
      const source=key(path.basename(item.source));
      const matching=records.filter(record=>typeof record.source==='string'&&pathKey(record.source)===pathKey(item.source));
      if(moved.has(source)||matching.length!==1||!originals.has(source)||matching[0].beforeSha256!==originals.get(source))return before;
      moved.add(source);
      if(group==='duplicate')continue;
      const record=matching[0];
      const validTarget=group==='assigned'?standardized(record.targetName):/\.jpg$/i.test(record.targetName||'');
      if(!validName(record.targetName)||!validTarget||record.targetName!==item.targetName
        ||record.kind!==item.kind||!validHash(record.afterSha256)||targets.has(key(record.targetName)))return before;
      if(group==='unresolved'&&record.kind!=='unresolved-standardized')return before;
      targets.set(key(record.targetName),record.afterSha256);
    }
  }
  const after=new Map(originals);
  for(const source of moved)after.delete(source);
  for(const [name,sha256] of targets) {
    if(after.has(name))return before;
    after.set(name,sha256);
  }
  return after;
}

export function photoFilesMatchPlan(plan,receipt,currentFiles) {
  const expected=reviewedPhotoHashes(plan,receipt),seen=new Set();
  if(!expected||!Array.isArray(currentFiles))return false;
  for(const file of currentFiles) {
    if(!validName(file.name)||!validHash(file.sha256)||seen.has(key(file.name)))return false;
    seen.add(key(file.name));
    if(standardized(file.name)&&expected.get(key(file.name))!==file.sha256)return false;
  }
  return true;
}

// A main-button resume may skip recognition only when the entire inbox is the
// exact post-transaction file set.  The looser upload gate above deliberately
// permits additional raw files so already confirmed photos can still upload;
// it must not be used to decide that there is no new work to recognize.
export function photoFilesExactlyMatchPlan(plan,receipt,currentFiles) {
  const expected=reviewedPhotoHashes(plan,receipt),current=new Map();
  if(!expected||!Array.isArray(currentFiles))return false;
  for(const file of currentFiles) {
    if(!validName(file.name)||!validHash(file.sha256)||current.has(key(file.name)))return false;
    current.set(key(file.name),file.sha256);
  }
  if(current.size!==expected.size)return false;
  for(const [name,sha256] of expected)if(current.get(name)!==sha256)return false;
  // A stale no-op plan must never supersede a stronger completed preparation
  // receipt.  This catches the historical 11-confirmed -> 6-confirmed retry
  // regression even if both happen to describe the same files on disk.
  const priorBlessingCount=Number(receipt?.blessingCount||0);
  if(priorBlessingCount>0&&(!Array.isArray(plan?.allowedBlessingNumbers)
    || plan.allowedBlessingNumbers.length<priorBlessingCount))return false;
  return true;
}

// Return only outputs whose exact bytes are bound by both the prior recognition
// plan and its committed transformation receipt.  A supplement run can trust
// these files and OCR only newly arrived raw photos; filenames alone are never
// sufficient evidence.
export function trustedPreparedOutputs(plan,receipt,currentFiles) {
  if(plan?.photoInputBinding?.schemaVersion!==1||!Array.isArray(plan.photoInputBinding.files)
    ||!Array.isArray(plan.assignments)||!Array.isArray(receipt?.files)
    ||receipt.businessDate!==plan.businessDate||!Array.isArray(currentFiles))return [];
  const plannedAt=Date.parse(plan.createdAt),completedAt=Date.parse(receipt.completedAt);
  if(!Number.isFinite(plannedAt)||!Number.isFinite(completedAt)||completedAt<plannedAt)return [];
  const originals=new Map(plan.photoInputBinding.files.map(file=>[key(file.name),file.sha256]));
  const current=new Map(currentFiles.map(file=>[key(file.name),file.sha256]));
  const allowed=new Set((plan.allowedBlessingNumbers||[]).map(Number).filter(Number.isInteger));
  const outputs=[];
  for(const record of receipt.files) {
    if(typeof record?.source!=='string'||!validName(record.targetName)||!validHash(record.beforeSha256)
      ||!validHash(record.afterSha256)||!['blessing','scene-lamp','scene-water'].includes(record.kind))continue;
    const assignment=plan.assignments.find(item=>typeof item?.source==='string'
      &&pathKey(item.source)===pathKey(record.source)&&item.targetName===record.targetName&&item.kind===record.kind);
    if(!assignment||originals.get(key(path.basename(record.source)))!==record.beforeSha256
      ||current.get(key(record.targetName))!==record.afterSha256)continue;
    const stem=path.parse(record.targetName).name,number=/^\d+$/.test(stem)?Number(stem):null;
    if(record.kind==='blessing'&&(!Number.isInteger(number)||!allowed.has(number)))continue;
    outputs.push({name:record.targetName,sha256:record.afterSha256,kind:record.kind,number});
  }
  return outputs;
}

export function retainVerifiedUploadEvidence(previousUploadedFiles,currentFiles) {
  if(!previousUploadedFiles||typeof previousUploadedFiles!=='object'||!Array.isArray(currentFiles))return {};
  const current=new Map();
  for(const file of currentFiles) {
    if(!validName(file?.name)||!validHash(file?.sha256)||current.has(key(file.name)))return {};
    current.set(key(file.name),file.sha256);
  }
  const retained={};
  for(const [name,evidence] of Object.entries(previousUploadedFiles)) {
    if(validName(name)&&validHash(evidence?.sha256)&&current.get(key(name))===evidence.sha256)retained[name]=evidence;
  }
  return retained;
}

export function assertPhotoFilesMatchPlan(plan,receipt,currentFiles) {
  if(!photoFilesMatchPlan(plan,receipt,currentFiles)) {
    throw Error('照片内容与识别计划或处理回执不一致，未上传或修改订单；请重新核对编号并完成照片处理。');
  }
}

// Keep initialization lightweight; write actions need a current mixed-inbox plan.

export function mustRebuildPhotoPlan({indexReusable,standardizedOnly,imageCount,action}) {
  return !indexReusable && imageCount>0 && (standardizedOnly || ['photo-upload','photo-scenes'].includes(action));
}

export function assertWritePlanReady(plan,{imageCount,action}) {
  if(imageCount>0&&['photo-upload','photo-scenes'].includes(action))assertPhotoReviewIsolation(plan);
  if(imageCount>0 && ['photo-upload','photo-scenes'].includes(action)
    && (!plan?.safeToApply || plan.issues?.length || !Array.isArray(plan.allowedBlessingNumbers)
      || !['not-needed','veto-only-not-order-binding'].includes(plan.bodyClaimReview?.status))) {
    throw Error('当前照片计划缺少完整的新版本安全检查或仍有硬冲突，未上传或修改订单；请重新核对编号并处理提示。');
  }
}
