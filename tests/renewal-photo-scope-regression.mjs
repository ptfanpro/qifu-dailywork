import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resolveRenewalPhotoScope,validateRenewalPhotoScope,loadRenewalPhotoScope} from '../src/renewal-photo-scope.mjs';
const hash=rows=>crypto.createHash('sha256').update(rows.map(row=>row.id).sort().join('\n')).digest('hex');
const date='2026-10-14';
const rows=[{id:'synthetic-renewal-1',blessingCode:'renewal-223',prayerDate:'2026-10-15',status:'已完成'},
  {id:'synthetic-renewal-2',blessingCode:'renewal-224',prayerDate:'2026-10-15',status:'已完成'}];
const receipt={businessDate:date,verifiedAt:'2026-10-14T02:00:00Z',orderCount:2,orderIdHash:hash(rows),
  coveredRows:rows,outputs:[{pageCount:2,sha256:'b'.repeat(64)}]};
const manifest={businessDate:date,rows,orderIdHash:hash(rows)};
const scope=resolveRenewalPhotoScope({date,receipt,manifest});
assert.deepEqual(scope.rows,rows,'legacy receipts retain next-day-start, already processed renewal orders');
assert.equal(resolveRenewalPhotoScope({date,receipt:null}),null);
for(const overrides of [{businessDate:'2026-10-13'},{orderIdHash:'c'.repeat(64)},{rows:[rows[0]]}]) {
  assert.throws(()=>resolveRenewalPhotoScope({date,receipt,manifest:{...manifest,...overrides}}),/不一致/);
}
for(const overrides of [{businessDate:'2026-10-13'},{verifiedAt:null},{outputs:[]},{coveredRows:[rows[0]]}]) {
  assert.throws(()=>resolveRenewalPhotoScope({date,receipt:{...receipt,...overrides},manifest}));
}
assert.throws(()=>validateRenewalPhotoScope({...scope,rows:[rows[0],rows[0]],orderIdHash:hash([rows[0],rows[0]])},date),/不一致/);
assert.throws(()=>validateRenewalPhotoScope(scope,'2026-10-15'),/不一致/);
const nextRows=[...rows,{id:'same-day-supplement',blessingCode:'renewal-225'}];
const union=resolveRenewalPhotoScope({date,receipt:{...receipt,coveredRows:nextRows,coveredOrderIdHash:hash(nextRows)},manifest});
assert.equal(union.rows.length,3,'new cumulative receipt hashes include earlier batches and same-day supplements');
assert.throws(()=>resolveRenewalPhotoScope({date,receipt:{...receipt,coveredOrderIdHash:'a'.repeat(64)},manifest}),/不一致/);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-renewal-scope-'));
try {
  assert.equal(loadRenewalPhotoScope(temp,date),null);
  fs.writeFileSync(path.join(temp,'renewal-pdf-receipt.json'),JSON.stringify(receipt));
  fs.writeFileSync(path.join(temp,'renewal-manifest.json'),JSON.stringify(manifest));
  assert.deepEqual(loadRenewalPhotoScope(temp,date),scope);
}finally{assert.equal(path.dirname(fs.realpathSync(temp)).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());fs.rmSync(temp,{recursive:true,force:true});}
console.log('Renewal photo scope PASS: exact business date, ID hash, legacy and cumulative receipts; no PDF or OCR read');
