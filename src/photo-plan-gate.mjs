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
  const assignments=plan.assignments||[],duplicates=plan.duplicateSources||[];
  if(!Array.isArray(assignments)||!Array.isArray(duplicates))return null;
  const before=new Map(originals);
  // A numeric source awaiting renumbering is not eligible under its old name.
  for(const item of assignments) {
    if(typeof item.source!=='string'||!validName(item.targetName))return null;
    if(key(path.basename(item.source))!==key(item.targetName))before.delete(key(path.basename(item.source)));
  }
  if(!receipt)return before;
  const plannedAt=Date.parse(plan.createdAt),completedAt=Date.parse(receipt.completedAt);
  if(!Number.isFinite(plannedAt)||!Number.isFinite(completedAt)||completedAt<plannedAt
    ||receipt.businessDate!==plan.businessDate||!Array.isArray(receipt.files)
    ||receipt.files.length!==assignments.length||!Array.isArray(receipt.duplicates)
    ||receipt.duplicates.length!==duplicates.length||typeof plan.photoDir!=='string')return before;
  const moved=new Set(),targets=new Map();
  for(const [items,records,isDuplicate] of [[assignments,receipt.files,false],[duplicates,receipt.duplicates,true]]) {
    for(const item of items) {
      if(typeof item.source!=='string'||pathKey(path.dirname(item.source))!==pathKey(plan.photoDir))return before;
      const source=key(path.basename(item.source));
      const matching=records.filter(record=>typeof record.source==='string'&&pathKey(record.source)===pathKey(item.source));
      if(moved.has(source)||matching.length!==1||!originals.has(source)||matching[0].beforeSha256!==originals.get(source))return before;
      moved.add(source);
      if(isDuplicate)continue;
      const record=matching[0];
      if(!validName(record.targetName)||!standardized(record.targetName)||record.targetName!==item.targetName
        ||record.kind!==item.kind||!validHash(record.afterSha256)||targets.has(key(record.targetName)))return before;
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
