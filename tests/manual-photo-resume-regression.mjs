import assert from 'node:assert/strict';
import { PrayerSite } from '../src/site.mjs';
import { decideManualPhotoResume, manualPhotoUploadProgress } from '../src/workflow-state.mjs';

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
