import assert from 'node:assert/strict';
import { PrayerSite } from '../src/site.mjs';
import { decideManualPhotoResume, decideManualPhotoUncertainRetry, retainManualPhotoAttemptEvidence, restoreUnusedManualUploadRetryCount, manualPhotoUploadProgress } from '../src/workflow-state.mjs';

for (const method of ['queryUploadedOrders', 'queryNotUploadedOrders']) {
  let call;
  const site = { queryOrdersByBlessingUploadStatus: async (...args) => { call = args; return []; } };
  await PrayerSite.prototype[method].call(site, '2026-09-28', { allStates: true });
  assert.equal(new URL(call[2].url).searchParams.get('typeCode'), 'qifudeng');
}

const base = {
  blessingCount: 10,
  verifiedReceiptCount: 7,
  pendingFiles: ['8.jpg', '9.jpg', '10.jpg'],
  uncertainSubmission: false,
  onlineUploadedCount: 42,
  onlinePendingRows: [{ id: 'lamp-1', kind: 'lamp' }, { id: 'tablet-1', kind: 'tablet' }],
};
const recovered = decideManualPhotoResume(base);
assert.equal(recovered.allowed, true);
assert.deepEqual(recovered.pendingFiles, ['8.jpg', '9.jpg', '10.jpg']);
assert.deepEqual(recovered.pendingOrderRows, base.onlinePendingRows);
assert.equal(decideManualPhotoResume({ ...base, blessingCount: 13, verifiedReceiptCount: 12,
  pendingFiles: ['472.jpg'], onlinePendingRows: [{ id: 'last-order', kind: 'tablet' }] }).allowed, true);

for (const override of [
  { verifiedReceiptCount: 0 },
  { verifiedReceiptCount: 6 },
  { pendingFiles: [] },
  { pendingFiles: ['8.jpg', '8.jpg', '10.jpg'] },
  { uncertainSubmission: true },
  { onlineUploadedCount: 0 },
  { onlinePendingRows: [] },
  { onlinePendingRows: [{ id: 'x', kind: 'lamp' }, { id: 'x', kind: 'lamp' }] },
  { onlinePendingRows: [{ id: '', kind: 'tablet' }] },
  { onlinePendingRows: [{ id: 'x', kind: 'other' }] },
]) assert.equal(decideManualPhotoResume({ ...base, ...override }).allowed, false);

const progress = manualPhotoUploadProgress(base.onlinePendingRows,
  [{ id: 'lamp-1', kind: 'lamp' }], [{ id: 'tablet-1', kind: 'tablet' }]);
assert.deepEqual(progress, { confirmed: true, movedCount: 1, remainingRows: [{ id: 'tablet-1', kind: 'tablet' }] });
assert.equal(manualPhotoUploadProgress(base.onlinePendingRows, [], base.onlinePendingRows).confirmed, false);
assert.equal(manualPhotoUploadProgress(base.onlinePendingRows, [{ id: 'lamp-1', kind: 'lamp' }], []).confirmed, false);
assert.equal(manualPhotoUploadProgress(base.onlinePendingRows,
  [{ id: 'lamp-1', kind: 'lamp' }], [{ id: 'lamp-1', kind: 'lamp' }, { id: 'tablet-1', kind: 'tablet' }]).confirmed, false);

console.log('Manual photo resume regression PASS');

// A click without a numeric receipt can be retried once only after the same
// business date, files and complete online order set are rechecked later.
const now='2026-10-01T13:00:00.000Z';
const zero={
  blessingCount:13, verifiedReceiptCount:0,
  pendingFiles:Array.from({length:13},(_,index)=>`${index+1}.jpg`),
  previousAttempt:{stage:'month-submitted',files:Array.from({length:13},(_,index)=>`${index+1}.jpg`),
    startedAt:'2026-10-01T12:00:00.000Z',uploadedCount:null},
  uncertainRetryCount:0, onlineUploadedCount:0,
  firstPendingRows:Array.from({length:150},(_,index)=>({id:`order-${index}`,kind:index===149?'tablet':'lamp'})),
  secondPendingRows:Array.from({length:150},(_,index)=>({id:`order-${index}`,kind:index===149?'tablet':'lamp'})),
  now,
};
assert.equal(decideManualPhotoUncertainRetry(zero).allowed,true);
for(const override of [
  {verifiedReceiptCount:1}, {onlineUploadedCount:1}, {uncertainRetryCount:1},
  {previousAttempt:{...zero.previousAttempt,uploadedCount:13}},
  {previousAttempt:{...zero.previousAttempt,startedAt:'2026-10-01T12:59:00.000Z'}},
  {previousAttempt:{...zero.previousAttempt,files:['other.jpg']}},
  {secondPendingRows:zero.secondPendingRows.slice(1)},
  {secondPendingRows:zero.secondPendingRows.map((row,index)=>index===0?{...row,id:'different'}:row)},
  {firstPendingRows:[...zero.firstPendingRows,{id:'order-0',kind:'lamp'}]},
  {previousAttempt:{...zero.previousAttempt,stage:'not-started'}},
]) assert.equal(decideManualPhotoUncertainRetry({...zero,...override}).allowed,false);
assert.equal(decideManualPhotoUncertainRetry({...zero,
  previousAttempt:{...zero.previousAttempt,startedAt:null}}).allowed,false);
const legacyAttempt=retainManualPhotoAttemptEvidence({
  uncertainSubmission:true,startedAt:'2026-10-01T12:00:00.000Z',stage:'not-started',
  previousAttempt:{stage:'month-submitted',files:zero.pendingFiles,uploadedCount:null},
});
assert.equal(legacyAttempt.startedAt,'2026-10-01T12:00:00.000Z');
assert.equal(decideManualPhotoUncertainRetry({...zero,previousAttempt:legacyAttempt}).allowed,true);
assert.equal(retainManualPhotoAttemptEvidence({
  uncertainSubmission:true,startedAt:'2026-10-01T12:00:00.000Z',
  previousAttempt:{stage:'month-submitted',files:zero.pendingFiles,uploadedCount:null},
  currentBatchUploadCount:13,
}).uploadedCount,13);
console.log('Manual uncertain upload bounded recovery PASS');
const unused={uncertainRetryCount:1,currentBatchUploadEvidence:{requestStarted:false,responseSeen:false},
  uncertainRetryEvidence:{originalAttempt:zero.previousAttempt}};
assert.equal(restoreUnusedManualUploadRetryCount(unused),0);
for(const patch of [
  {currentBatchUploadEvidence:{requestStarted:true,responseSeen:false}},
  {currentBatchUploadEvidence:{requestStarted:false,responseSeen:true}},
  {currentBatchUploadEvidence:null},{currentBatchUploadCount:13},{uncertainRetryEvidence:null},
]) assert.equal(restoreUnusedManualUploadRetryCount({...unused,...patch}),1);

// A newly submitted retry is a new attempt. Its timestamp, filenames and order
// scope must stay together rather than inheriting old metadata or an old count.
const olderAttempt = {stage:'month-submitted',files:['old.jpg'],startedAt:'2026-10-01T12:00:00.000Z',
  pendingOrderIdHash:'old-scope',pendingOrderCount:12,uploadedCount:12};
const currentSubmission = {uncertainSubmission:true,previousAttempt:olderAttempt,
  stage:'transport-response',currentBatchFiles:['new.jpg'],currentBatchStartedAt:'2026-10-01T12:59:00.000Z',
  pendingOrderIdHash:'new-scope',pendingOrderCount:3,currentBatchTransportResponseSeen:true,
  currentBatchUploadCount:null};
const newest = retainManualPhotoAttemptEvidence(currentSubmission);
assert.deepEqual(newest,{stage:'transport-response',files:['new.jpg'],startedAt:'2026-10-01T12:59:00.000Z',
  pendingOrderIdHash:'new-scope',pendingOrderCount:3,uploadedCount:null});
assert.equal(retainManualPhotoAttemptEvidence({...currentSubmission,currentBatchUploadCount:1}).uploadedCount,1);
assert.equal(retainManualPhotoAttemptEvidence({...currentSubmission,pendingOrderIdHash:null,pendingOrderCount:null}).pendingOrderIdHash,null,
  'a missing current scope cannot be borrowed from a different attempt');
const restarted = retainManualPhotoAttemptEvidence({uncertainSubmission:true,stage:'not-started',previousAttempt:newest});
assert.deepEqual(restarted,newest,'a later read-only restart retains the same exact attempt');
const notSubmitted = retainManualPhotoAttemptEvidence({...currentSubmission,stage:'starting',
  currentBatchTransportResponseSeen:false,currentBatchTransportRequestSeen:false});
assert.deepEqual(notSubmitted,olderAttempt,'preparing a retry does not replace an earlier unresolved submission');
const withFreshCount = {...currentSubmission,stage:'manual-photo-online-unconfirmed',currentBatchUploadCount:1};
assert.equal(retainManualPhotoAttemptEvidence(withFreshCount).startedAt,currentSubmission.currentBatchStartedAt);
const afterDiagnostic = {...currentSubmission,stage:'manual-photo-online-image-readback-incomplete',
  currentBatchSubmissionStage:'month-submitted',currentBatchTransportResponseSeen:false};
assert.deepEqual(retainManualPhotoAttemptEvidence(afterDiagnostic),{...newest,stage:'month-submitted'},
  'a later diagnostic stage cannot erase a known current submission boundary');
assert.deepEqual(retainManualPhotoAttemptEvidence({...currentSubmission,
  currentBatchPendingOrderIdHash:'batch-scope',currentBatchPendingOrderCount:2}),
  {...newest,pendingOrderIdHash:'batch-scope',pendingOrderCount:2});
assert.equal(retainManualPhotoAttemptEvidence({...currentSubmission,uncertainSubmission:false}),null);
console.log('Manual upload attempt identity retention regression PASS');
