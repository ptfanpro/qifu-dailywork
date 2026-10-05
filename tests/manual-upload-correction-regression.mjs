import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareManualUploadCorrectionReview,approveManualUploadCorrection,markManualUploadCorrectionSubmitted,
  confirmManualUploadCorrection,retainManualUploadCorrectionState,manualCorrectionPreparationHashes,
  readManualCorrectionPreparationHashes,hasPendingManualUploadCorrection,finalizeManualUploadCorrection} from '../src/manual-upload-correction.mjs';
import {decideManualPhotoUncertainRetry} from '../src/workflow-state.mjs';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const now='2026-10-05T04:00:00.000Z',date='2026-10-02';
const pendingRows=[{kind:'lamp',id:'first'},{kind:'tablet',id:'second'}];
const pendingHash=crypto.createHash('sha256').update(pendingRows.map(row=>`${row.kind}:${row.id}`).sort().join('\n')).digest('hex');
const hashes={'11.jpg':sha('first'),'111.jpg':sha('first'),'12.jpg':sha('second')};
const receipt={businessDate:date,complete:false,uncertainSubmission:true,uncertainRetryCount:1,
  stage:'manual-photo-retry-evidence-conflict',uploadedCount:0,uploadedFiles:{},
  previousAttempt:{stage:'month-submitted',files:['11.jpg','111.jpg','12.jpg'],
    startedAt:'2026-10-03T06:38:54.215Z',pendingOrderIdHash:pendingHash,pendingOrderCount:2,uploadedCount:null}};
const preparationReceipt={businessDate:date,completedAt:'2026-10-03T04:03:17.801Z',files:
  Object.entries(hashes).map(([targetName,afterSha256])=>({kind:'blessing',targetName,
    beforeSha256:sha('uncompressed-original'),afterSha256}))};
const input={businessDate:date,receipt,currentFiles:['11.jpg','12.jpg'],currentFileHashes:hashes,
  preparationReceipt,firstOnline:{uploadedCount:0,pendingRows},secondOnline:{uploadedCount:0,pendingRows:[...pendingRows].reverse()},now};
const review=prepareManualUploadCorrectionReview(input);
assert.equal(review.eligible,true);
assert.deepEqual(review.removedFiles,[{name:'111.jpg',duplicateOf:'11.jpg',sha256:hashes['111.jpg']}]);
assert.equal(review.pendingOrderIdHash,pendingHash);
assert.equal(review.oldUncertainRetryCount,1);
assert.match(review.warning,/人工确认/);
assert.equal(prepareManualUploadCorrectionReview({...input,now:'2026-10-05T04:01:00.000Z'}).confirmationToken,review.confirmationToken);
assert.deepEqual(receipt.uploadedFiles,{});
assert.equal(receipt.correctedAttempts,undefined,'preparing a review must not mutate the receipt');

for (const [reason,patch] of [
  ['bad date',{businessDate:'2026-02-30'}],
  ['other date',{businessDate:'2026-10-03'}],
  ['unchanged batch',{currentFiles:['11.jpg','111.jpg','12.jpg']}],
  ['missing entire content',{currentFiles:['11.jpg']}],
  ['unknown added file',{currentFiles:['11.jpg','13.jpg']}],
  ['unsafe filename',{currentFiles:['../11.jpg','12.jpg']}],
  ['case alias',{currentFiles:['11.jpg','11.JPG']}],
  ['changed bytes',{currentFileHashes:{...hashes,'12.jpg':sha('replaced')}}],
  ['still duplicated',{currentFiles:['11.jpg','111.jpg']}],
  ['missing current hash',{currentFileHashes:{'11.jpg':hashes['11.jpg']}}],
  ['already uploaded',{firstOnline:{uploadedCount:1,pendingRows}}],
  ['inconsistent snapshots',{secondOnline:{uploadedCount:0,pendingRows:pendingRows.slice(1)}}],
  ['duplicate order row',{firstOnline:{uploadedCount:0,pendingRows:[...pendingRows,pendingRows[0]]}}],
  ['unsafe order id',{firstOnline:{uploadedCount:0,pendingRows:[{kind:'lamp',id:'first\nsecond'}]}}],
  ['nonzero snapshot',{secondOnline:{uploadedCount:1,pendingRows}}],
  ['negative uploaded count',{secondOnline:{uploadedCount:-1,pendingRows}}],
  ['before wait',{now:'2026-10-03T06:45:00.000Z'}],
  ['preparation wrong date',{preparationReceipt:{...preparationReceipt,businessDate:'2026-10-01'}}],
  ['preparation after attempt',{preparationReceipt:{...preparationReceipt,completedAt:'2026-10-04T00:00:00.000Z'}}],
  ['malformed preparation items',{preparationReceipt:{...preparationReceipt,files:{}}}],
  ['missing old file hash',{preparationReceipt:{...preparationReceipt,files:preparationReceipt.files.slice(1)}}],
  ['conflicting old file hash',{preparationReceipt:{...preparationReceipt,files:[...preparationReceipt.files,
    {...preparationReceipt.files[0],afterSha256:sha('other')}]}}],
]) assert.equal(prepareManualUploadCorrectionReview({...input,...patch}).eligible,false,reason);

for (const [reason,patch] of [
  ['any receipt',{uploadedFiles:{'11.jpg':{sha256:hashes['11.jpg']}}}],
  ['numeric count',{currentBatchUploadCount:0}],
  ['completed',{complete:true}],
  ['not uncertain',{uncertainSubmission:false}],
  ['batch count evidence',{batches:[{uploadedCount:3}]}],
  ['malformed batch evidence',{batches:{}}],
  ['unsafe old name',{previousAttempt:{...receipt.previousAttempt,files:['11.jpg','../111.jpg','12.jpg']}}],
  ['duplicate old name',{previousAttempt:{...receipt.previousAttempt,files:['11.jpg','11.jpg','12.jpg']}}],
  ['missing old scope',{previousAttempt:{...receipt.previousAttempt,pendingOrderIdHash:null}}],
  ['changed old scope',{previousAttempt:{...receipt.previousAttempt,pendingOrderIdHash:sha('other')}}],
  ['old count mismatch',{previousAttempt:{...receipt.previousAttempt,pendingOrderCount:310}}],
  ['numeric old result',{previousAttempt:{...receipt.previousAttempt,uploadedCount:3}}],
  ['unknown old phase',{previousAttempt:{...receipt.previousAttempt,stage:'unknown'}}],
  ['direct and historical hash conflict',{previousAttempt:{...receipt.previousAttempt,fileHashes:{'111.jpg':sha('other')}}}],
]) assert.equal(prepareManualUploadCorrectionReview({...input,receipt:{...receipt,...patch}}).eligible,false,reason);

const direct=prepareManualUploadCorrectionReview({...input,preparationReceipt:null,
  receipt:{...receipt,previousAttempt:{...receipt.previousAttempt,fileHashes:hashes}}});
assert.equal(direct.eligible,true);
assert.equal(direct.confirmationToken,review.confirmationToken,'equivalent hash evidence binds the same correction');
assert.equal(prepareManualUploadCorrectionReview({...input,
  preparationReceipt:{...preparationReceipt,completedAt:now,files:[]},
  receipt:{...receipt,previousAttempt:{...receipt.previousAttempt,fileHashes:hashes}}}).eligible,true,
  'complete original attempt hashes do not depend on a subsequently overwritten preparation receipt');
assert.equal(prepareManualUploadCorrectionReview({...input,preparationReceipt:null,
  receipt:{...receipt,currentBatchFiles:['11.jpg','12.jpg'],currentBatchFileHashes:hashes,
    currentBatchStartedAt:now,stage:'files-selected'}}).eligible,false,
  'new unsubmitted batch hashes cannot be borrowed as old submitted bytes');
const manyFiles=Array.from({length:51},(_,i)=>`${i+1}.jpg`);
const manyHashes=Object.fromEntries(manyFiles.map(name=>[name,sha(name)]));
manyHashes['111.jpg']=manyHashes['1.jpg'];
assert.equal(prepareManualUploadCorrectionReview({...input,currentFiles:manyFiles,currentFileHashes:manyHashes,
  preparationReceipt:null,receipt:{...receipt,
    previousAttempt:{...receipt.previousAttempt,files:[...manyFiles,'111.jpg'],fileHashes:manyHashes}}}).eligible,false,
  'correction is limited to one platform upload batch');

let working=structuredClone(receipt);
for (const options of [{now},{now,confirmed:true},{now,confirmed:false,confirmationToken:review.confirmationToken},
  {now,confirmed:true,confirmationToken:'wrong'},
  {now:'2026-10-05T04:11:00.000Z',confirmed:true,confirmationToken:review.confirmationToken}]) {
  assert.throws(()=>approveManualUploadCorrection(working,review,options),/人工确认/);
}
assert.equal(working.correctedAttempts,undefined);
assert.throws(()=>approveManualUploadCorrection(working,{...review,currentFiles:['11.jpg']},
  {now,confirmed:true,confirmationToken:review.confirmationToken}),/人工确认/);
assert.throws(()=>approveManualUploadCorrection({...working,uncertainRetryCount:0},review,
  {now,confirmed:true,confirmationToken:review.confirmationToken}),/人工确认/);
const approved=approveManualUploadCorrection(working,review,{now,confirmed:true,confirmationToken:review.confirmationToken});
assert.equal(approved.status,'approved');
assert.equal(hasPendingManualUploadCorrection(working),false);
assert.deepEqual(approved.oldReceipt,receipt);
assert.equal(working.uncertainRetryCount,1,'an explicit correction never clears the old retry count');
assert.deepEqual(working.previousAttempt,receipt.previousAttempt);
assert.equal(markManualUploadCorrectionSubmitted(working,review.correctionId,'files-selected',{now}),false);

// Preparation can fail and change the working batch fields. The approved
// correction keeps its immutable original attempt, even over several restarts.
for (let restart=0;restart<3;restart++) {
  working={...structuredClone(receipt),...retainManualUploadCorrectionState(working),stage:'files-selected',
    currentBatchFiles:['11.jpg','12.jpg'],currentBatchStartedAt:now,currentBatchSubmissionStage:null,
    currentBatchTransportRequestSeen:false,currentBatchTransportResponseSeen:false,
    previousAttempt:{stage:'not-started',files:['other.jpg'],startedAt:now}};
  const renewed=prepareManualUploadCorrectionReview({...input,receipt:working,
    preparationReceipt:{...preparationReceipt,completedAt:now,files:[]}});
  assert.equal(renewed.eligible,true);
  assert.equal(renewed.confirmationToken,review.confirmationToken);
  assert.deepEqual(renewed.oldAttempt,review.oldAttempt);
  assert.equal(approveManualUploadCorrection(working,renewed,{now,confirmed:true,
    confirmationToken:review.confirmationToken}).status,'approved');
}
const copy=retainManualUploadCorrectionState(working);
copy.correctedAttempts[review.correctionId].oldReceipt.previousAttempt.files.push('999.jpg');
assert.deepEqual(working.correctedAttempts[review.correctionId].oldReceipt,receipt);
const tampered=structuredClone(working);
tampered.correctedAttempts[review.correctionId].review.oldFileHashes['111.jpg']=sha('tampered');
assert.equal(prepareManualUploadCorrectionReview({...input,receipt:tampered}).eligible,false,
  'approved audit hashes cannot be changed without invalidating the bound correction');
assert.equal(markManualUploadCorrectionSubmitted(working,review.correctionId,'month-submit-started',{now}),true);
assert.equal(markManualUploadCorrectionSubmitted(working,review.correctionId,'transport-request',{now}),false);
assert.equal(working.correctedAttempts[review.correctionId].status,'submitting');
assert.equal(hasPendingManualUploadCorrection(working),true);
assert.equal(working.uncertainRetryCount,1);
assert.equal(prepareManualUploadCorrectionReview({...input,receipt:working}).eligible,false);
assert.throws(()=>approveManualUploadCorrection(working,review,{now,confirmed:true,confirmationToken:review.confirmationToken}),/人工确认/);
assert.throws(()=>confirmManualUploadCorrection(working,review.correctionId,{now,uploadedFileHashes:{}}),/逐文件/);
assert.equal(confirmManualUploadCorrection(working,review.correctionId,{now,uploadedFileHashes:hashes}).status,'confirmed');
assert.equal(hasPendingManualUploadCorrection(working),false);
assert.throws(()=>markManualUploadCorrectionSubmitted(working,review.correctionId,'submitting',{now}),/再次提交/);
assert.equal(prepareManualUploadCorrectionReview({...input,receipt:working}).eligible,false);

// Explicit correction authorization is a separate one-shot operation even
// when the older ordinary retry budget was zero. A restart must not transfer
// the submitted corrected batch into that otherwise available ordinary retry.
const zeroBudgetReceipt={...structuredClone(receipt),uncertainRetryCount:0};
const zeroBudgetReview=prepareManualUploadCorrectionReview({...input,receipt:zeroBudgetReceipt});
assert.equal(zeroBudgetReview.eligible,true);
approveManualUploadCorrection(zeroBudgetReceipt,zeroBudgetReview,
  {now,confirmed:true,confirmationToken:zeroBudgetReview.confirmationToken});
markManualUploadCorrectionSubmitted(zeroBudgetReceipt,zeroBudgetReview.correctionId,'submitting',{now});
assert.equal(zeroBudgetReceipt.uncertainRetryCount,0,'retain the original budget rather than falsifying its history');
const ordinaryRetry={blessingCount:2,verifiedReceiptCount:0,pendingFiles:['11.jpg','12.jpg'],
  previousAttempt:{...receipt.previousAttempt,files:['11.jpg','12.jpg']},uncertainRetryCount:0,
  onlineUploadedCount:0,secondOnlineUploadedCount:0,firstPendingRows:pendingRows,secondPendingRows:pendingRows,now};
assert.equal(decideManualPhotoUncertainRetry(ordinaryRetry).allowed,true);
assert.equal(decideManualPhotoUncertainRetry({...ordinaryRetry,
  correctionSubmissionPending:hasPendingManualUploadCorrection(zeroBudgetReceipt)}).allowed,false);
const restartedZero={uncertainRetryCount:0,...retainManualUploadCorrectionState(zeroBudgetReceipt)};
assert.equal(hasPendingManualUploadCorrection(restartedZero),true);
assert.equal(hasPendingManualUploadCorrection({...restartedZero,activeCorrectionId:null}),true);
assert.equal(hasPendingManualUploadCorrection({activeCorrectionId:'missing',correctedAttempts:{}}),true);
assert.equal(hasPendingManualUploadCorrection({correctedAttempts:{unknown:{status:'unknown'}}}),true);

// Both early returns (already saved receipts and online image readback) close
// an approved review with no POST when every retained file is proven uploaded.
const early=structuredClone(receipt);
approveManualUploadCorrection(early,review,{now,confirmed:true,confirmationToken:review.confirmationToken});
assert.throws(()=>finalizeManualUploadCorrection(early,{now}),/逐文件/);
assert.equal(early.activeCorrectionId,review.correctionId);
assert.equal(early.correctedAttempts[review.correctionId].status,'approved');
early.uploadedFiles={'11.jpg':{sha256:hashes['11.jpg'],evidence:'online-image-readback'}};
assert.throws(()=>finalizeManualUploadCorrection(early,{now}),/逐文件/);
early.uploadedFiles['12.jpg']={sha256:sha('wrong'),evidence:'online-image-readback'};
assert.throws(()=>finalizeManualUploadCorrection(early,{now}),/逐文件/);
early.uploadedFiles['12.jpg'].sha256=hashes['12.jpg'];
assert.equal(finalizeManualUploadCorrection(early,{now}),true);
assert.equal(early.activeCorrectionId,null);
assert.equal(early.uncertainRetryCount,1);
assert.deepEqual(early.correctedAttempts[review.correctionId].oldReceipt,receipt);
assert.equal(early.correctedAttempts[review.correctionId].status,'confirmed');
assert.equal(early.correctedAttempts[review.correctionId].evidence,'resolved-by-existing-receipts');
assert.equal(early.correctedAttempts[review.correctionId].submittedAt,undefined);
assert.equal(early.correctedAttempts[review.correctionId].submissionStage,null);
assert.equal(early.uploadedFiles['111.jpg'],undefined,'no receipt is invented for the removed duplicate');
assert.equal(finalizeManualUploadCorrection(early,{now}),false);
const submitted=structuredClone(receipt);
approveManualUploadCorrection(submitted,review,{now,confirmed:true,confirmationToken:review.confirmationToken});
markManualUploadCorrectionSubmitted(submitted,review.correctionId,'submitting',{now});
assert.throws(()=>finalizeManualUploadCorrection(submitted,{now}),/逐文件/);
assert.equal(submitted.activeCorrectionId,review.correctionId);
assert.equal(submitted.correctedAttempts[review.correctionId].status,'submitting');
submitted.uploadedFiles=structuredClone(early.uploadedFiles);
assert.equal(finalizeManualUploadCorrection(submitted,{now}),true);
assert.equal(submitted.activeCorrectionId,null);
assert.equal(submitted.correctedAttempts[review.correctionId].status,'confirmed');
assert.equal(submitted.correctedAttempts[review.correctionId].submittedAt,now);
assert.equal(submitted.correctedAttempts[review.correctionId].evidence,'verified-upload-receipts');
assert.equal(submitted.uncertainRetryCount,1);
const missingAudit={activeCorrectionId:'missing',correctedAttempts:{},uploadedFiles:early.uploadedFiles};
assert.throws(()=>finalizeManualUploadCorrection(missingAudit,{now}),/逐文件/);
assert.equal(missingAudit.activeCorrectionId,'missing');

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-correction-synthetic-'));
try {
  const file=path.join(temporary,'photo-prepare-receipt.json');
  fs.writeFileSync(file,JSON.stringify(preparationReceipt));
  const options={businessDate:date,attemptFiles:receipt.previousAttempt.files,attemptStartedAt:receipt.previousAttempt.startedAt};
  assert.deepEqual(readManualCorrectionPreparationHashes({file,...options}),hashes);
  assert.deepEqual(manualCorrectionPreparationHashes({preparationReceipt,...options}),hashes);
  assert.throws(()=>readManualCorrectionPreparationHashes({file:'\\\\server\\share\\receipt.json',...options}),/本机/);
  assert.throws(()=>readManualCorrectionPreparationHashes({file:'receipt.json',...options}),/本机/);
} finally {
  fs.rmSync(temporary,{recursive:true,force:true});
}
console.log('Manual duplicate-content correction approval regression PASS');
