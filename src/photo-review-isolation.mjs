import path from 'node:path';

const key=name=>name.toLowerCase();
const validName=name=>typeof name==='string'&&name.length>0&&!/[\\/:]/.test(name)&&!['.','..'].includes(name);
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

// A review is evidence about a proposal, not another mutable proposal field.
// Keep failed reviews even if a later resolver rewrites number/evidence/status.
export function pdfReviewBlockReason(item) {
  const history=item?.pdfClaimReviewHistory;
  if(history!==undefined&&(!Array.isArray(history)||!history.length))return 'pdf-review-history-invalid';
  for(const review of [...(history||[]),...(item?.pdfRecheck?[item.pdfRecheck]:[])]) {
    if(!review||!['confirmed','rejected','inconclusive','unavailable'].includes(review.status))return 'pdf-review-record-invalid';
    if(review.status!=='confirmed')return review.reason||'pdf-review-not-confirmed';
  }
  return null;
}

export function recordPdfClaimReview(item,{status,reason,claimedNumber}) {
  const entry={status,reason:reason||null,claimedNumber};
  const previous=Array.isArray(item.pdfClaimReviewHistory)?item.pdfClaimReviewHistory
    : item.pdfClaimReviewHistory===undefined?[]:[{status:'unavailable',reason:'pdf-review-history-invalid'}];
  item.pdfClaimReviewHistory=[...previous,structuredClone(entry)];
  item.pdfRecheck=structuredClone(entry);
  if(status!=='confirmed'||pdfReviewBlockReason(item))item.reliable=false;
}

export function createPhotoReviewExclusions(items,inputBinding,blockReason) {
  const files=new Map();
  for(const item of items) {
    const reason=blockReason(item);
    if(!reason)continue;
    const name=path.basename(item.file),matches=inputBinding.files.filter(file=>key(file.name)===key(name));
    if(matches.length!==1||!validHash(matches[0].sha256))throw Error('待复核照片缺少唯一原图凭据，停止处理。');
    if(!files.has(key(name)))files.set(key(name),{name:matches[0].name,sha256:matches[0].sha256,reason});
  }
  return {schemaVersion:1,files:[...files.values()]};
}

// Names and hashes are tied to this plan's exact input. The exclusion is used
// before normalization, again at commit, and independently in upload scanning.
export function reviewExcludedPhotoNames(plan) {
  const scope=plan?.photoReviewExclusions;
  if(scope===undefined)return new Set(); // Old minimal test/receipt structures.
  if(scope?.schemaVersion!==1||!Array.isArray(scope.files)||!Array.isArray(plan.photoInputBinding?.files))
    throw Error('照片复核隔离凭据无效，请重新核对编号。');
  const names=new Set();
  for(const file of scope.files) {
    if(!validName(file?.name)||!validHash(file.sha256)||typeof file.reason!=='string'||!file.reason||names.has(key(file.name)))
      throw Error('照片复核隔离凭据无效，请重新核对编号。');
    const input=plan.photoInputBinding.files.filter(entry=>key(entry.name)===key(file.name));
    if(input.length!==1||input[0].sha256!==file.sha256)throw Error('照片复核隔离凭据与原图不一致。');
    names.add(key(file.name));
  }
  return names;
}

export function assertPhotoReviewIsolation(plan) {
  const names=reviewExcludedPhotoNames(plan);
  if(!names.size)return;
  const excludedNumbers=new Set([...names].filter(name=>/^\d+\.(?:jpe?g|png)$/i.test(name)).map(name=>Number(path.parse(name).name)));
  for(const item of [...(plan.assignments||[]),...(plan.duplicateSources||[])]) {
    if(names.has(key(path.basename(item.source)))||(item.targetName&&names.has(key(item.targetName)))
      ||(item.kind==='blessing'&&excludedNumbers.has(Number(path.parse(item.targetName||'').name)))
      ||(item.duplicateOfNumber!==undefined&&excludedNumbers.has(item.duplicateOfNumber)))
      throw Error('待复核照片不得改名、压缩、删除或作为场景上传；已停止提交。');
  }
  if(!Array.isArray(plan.allowedBlessingNumbers)||plan.allowedBlessingNumbers.some(number=>excludedNumbers.has(number)))
    throw Error('待复核照片仍在允许上传编号中，已停止提交。');
}
