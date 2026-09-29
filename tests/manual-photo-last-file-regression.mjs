import assert from 'node:assert/strict';
import { PrayerSite } from '../src/site.mjs';
import { decideManualPhotoSingleFileRetry, manualPhotoTargetOrderUploaded } from '../src/workflow-state.mjs';

for (const method of ['queryUploadedOrders', 'queryNotUploadedOrders']) {
  let call;
  const site = { queryOrdersByBlessingUploadStatus: async (...args) => { call = args; return []; } };
  await PrayerSite.prototype[method].call(site, '2026-09-28', { allStates: true });
  assert.equal(new URL(call[2].url).searchParams.get('typeCode'), 'qifudeng',
    `${method} must query the all-status lamp list, not the pending-only blessing list`);
}

const recovered = decideManualPhotoSingleFileRetry({
  blessingCount: 13,
  verifiedReceiptCount: 12,
  pendingFiles: ['472.jpg'],
  uncertainSubmission: false,
  onlineUploadedCount: 142,
  onlinePendingRows: [{ id: 'last-order', kind: 'tablet' }],
});
assert.deepEqual(recovered, { allowed: true, file: '472.jpg', pendingOrderId: 'last-order', kind: 'tablet' });

for (const override of [
  { verifiedReceiptCount: 0 },
  { pendingFiles: ['471.jpg', '472.jpg'] },
  { uncertainSubmission: true },
  { onlineUploadedCount: 0 },
  { onlinePendingRows: [] },
  { onlinePendingRows: [{ id: 'a' }, { id: 'b' }] },
]) {
  assert.equal(decideManualPhotoSingleFileRetry({
    blessingCount: 13,
    verifiedReceiptCount: 12,
    pendingFiles: ['472.jpg'],
    uncertainSubmission: false,
    onlineUploadedCount: 142,
    onlinePendingRows: [{ id: 'last-order', kind: 'tablet' }],
    ...override,
  }).allowed, false);
}

assert.equal(manualPhotoTargetOrderUploaded('last-order', [{id:'last-order'}], []), true);
assert.equal(manualPhotoTargetOrderUploaded('last-order', [{id:'other'}], []), false);
assert.equal(manualPhotoTargetOrderUploaded('last-order', [{id:'last-order'}], [{id:'last-order'}]), false);

console.log('Manual photo last-file regression PASS');
