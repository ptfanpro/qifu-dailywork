import assert from 'node:assert/strict';
import {buildHistoricalBacklogReport} from '../src/historical-backlog.mjs';

const row=(id,prayerDate)=>({id:String(id),prayerDate});
const report=buildHistoricalBacklogReport({
  asOfDate:'2026-09-26',
  pendingRegular:[row(1,'2026-09-20')],
  pendingTablet:[row(2,'2026-09-21')],
  prayingWithoutPhotoRegular:[row(3,'2026-09-22')],
  prayingWithoutPhotoTablet:[row(4,'2026-09-23')],
});
assert.equal(report.complete,false);
assert.equal(report.totalCount,4);
assert.equal(report.pendingPrayerCount,2);
assert.equal(report.prayingWithoutPhotoCount,2);
assert.deepEqual(report.businessDates,['2026-09-20','2026-09-21','2026-09-22','2026-09-23']);
assert.equal(report.range.endExclusive,'2026-09-26');

const empty=buildHistoricalBacklogReport({asOfDate:'2026-09-26'});
assert.equal(empty.complete,true);
assert.equal(empty.totalCount,0);

assert.throws(()=>buildHistoricalBacklogReport({
  asOfDate:'2026-09-26',pendingRegular:[row(5,'2026-09-26')],
}),/今天|范围/,'today must never enter the historical report');

console.log('Historical online backlog regression PASS: pending and praying-without-photo, excluding today');
