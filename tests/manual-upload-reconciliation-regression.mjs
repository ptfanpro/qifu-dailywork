import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {reconcileManualUploadedPhotos} from '../src/manual-upload-reconciliation.mjs';
import {uploadManualBatchWithRecovery} from '../src/manual-upload-attempt.mjs';

const require = createRequire(import.meta.url), sharp = require('sharp');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qifu-manual-reconcile-test-'));
try {
  const makeImage = (color, x) => sharp({create:{width:1800,height:1350,channels:3,background:color}})
    .composite([{input:Buffer.from(`<svg width="1800" height="1350"><rect x="${x}" y="450" width="300" height="400" fill="#153726"/></svg>`)}])
    .jpeg({quality:90}).toBuffer();
  const bytes = [await makeImage('#ead5bb',300), await makeImage('#ead5bb',900), await makeImage('#bbd5ea',600)];
  const allFiles = bytes.map((value,index) => {
    const file = path.join(temp, `${index + 1}.jpg`);
    fs.writeFileSync(file,value);
    return file;
  });
  const fileHashes = Object.fromEntries(allFiles.map((file,index) => [path.basename(file),hash(bytes[index])]));
  const date = '2026-10-03';
  const makeSite = (references, remote) => {
    const calls = [], reads = [], saved = [];
    return {calls, reads, saved, closed:0,
      async queryUploadedPhotoReferences(actualDate,kind) {
        calls.push([actualDate,kind]);
        return references[kind] || [];
      },
      async readUploadedPhotoBytes(url) { reads.push(url); if (!remote[url]) throw Error('read failed'); return remote[url]; },
      async closePhotoReadback() { this.closed++; },
      async uploadBlessingBatch() { throw Error('readback must never upload'); },
    };
  };
  const site = makeSite({tablet:[{id:'t1',kind:'tablet',url:'photo-a'}, {id:'t2',kind:'tablet',url:'photo-a'}],
    lamp:[{id:'l1',kind:'lamp',url:'photo-b'}, {id:'l2',kind:'lamp',url:'photo-missing'}]},
  {'photo-a':await sharp(bytes[0]).jpeg({quality:80}).toBuffer(), 'photo-b':bytes[1]});
  const result = await reconcileManualUploadedPhotos({site,date,files:allFiles,allFiles,fileHashes,
    onMatch:async (item) => site.saved.push(item)});
  assert.deepEqual(result.matched.map((item) => item.name), ['1.jpg','2.jpg']);
  assert.deepEqual(result.missingNames,['3.jpg']);
  assert.deepEqual(site.saved,result.matched,'each unique match is persisted before returning a partial result');
  assert.deepEqual(site.reads,['photo-a','photo-b','photo-missing'],'orders sharing an image do not duplicate reads');
  assert.deepEqual(site.calls,[[date,'tablet'],[date,'lamp']],'only two same-date read-only queries are made');
  assert.equal(site.closed,1);
  assert.equal(result.matched[0].matchMethod,'unique-raster');
  assert.equal(result.matched[1].matchMethod,'sha256');
  assert.equal(result.matched[1].sha256,fileHashes['2.jpg']);
  assert.equal(result.matched[0].onlineOrderIdHash,hash('tablet:t1'));
  assert.equal(result.scanned,3);

  // A previously confirmed paper stays in the competing set. Its remote image
  // must not be relabeled as the remaining, visually similar paper.
  const already = makeSite({tablet:[{id:'t1',kind:'tablet',url:'photo-a'}]},
    {'photo-a':await sharp(bytes[0]).jpeg({quality:80}).toBuffer()});
  const unchanged = await reconcileManualUploadedPhotos({site:already,date,files:[allFiles[1]],allFiles,fileHashes});
  assert.equal(unchanged.matched.length,0);
  assert.deepEqual(unchanged.missingNames,['2.jpg']);
  assert.equal(unchanged.diagnostics.reasons['already-accounted'],1);

  // A date containing one photo can still be proved by identical bytes.
  const single = makeSite({tablet:[{id:'t1',kind:'tablet',url:'one'}]}, {'one':bytes[0]});
  const singleton = await reconcileManualUploadedPhotos({site:single,date,files:[allFiles[0]],fileHashes});
  assert.deepEqual(singleton.missingNames,[]);
  assert.equal(singleton.matched[0].matchMethod,'sha256');
  assert.deepEqual(single.calls,[[date,'tablet']],'complete evidence needs no further page queries');

  const rejected=makeSite({},{});
  rejected.uploadBlessingBatch=async()=>{const error=new Error('后台提示“该图片已上传”，本批是否部分保存仍需核对');
    error.code='BLESSING_UPLOAD_OUTCOME_UNCONFIRMED';
    error.uploadEvidence={applicationFailure:true,responseOutcomes:[{category:'business-failure',reason:'duplicate-image'}]};
    throw error;};
  await assert.rejects(uploadManualBatchWithRecovery({site:rejected,date,files:allFiles,allFiles,fileHashes}),
    error=>error.code==='MANUAL_UPLOAD_READBACK_INCOMPLETE' && /该图片已上传/.test(error.message)
      && error.readback.scanned===0 && error.uploadEvidence.applicationFailure===true,
    'readback must retain the backend rejection instead of replacing it with a generic pending message');

  const duplicatePath = path.join(temp,'duplicate.jpg');
  fs.writeFileSync(duplicatePath,bytes[0]);
  const duplicate = makeSite({tablet:[{id:'t1',kind:'tablet',url:'one'}]}, {'one':bytes[0]});
  const ambiguous = await reconcileManualUploadedPhotos({site:duplicate,date,files:[allFiles[0]],
    allFiles:[allFiles[0],duplicatePath],fileHashes:{...fileHashes,'duplicate.jpg':hash(bytes[0])}});
  assert.equal(ambiguous.matched.length,0,'identical bytes under two local names cannot establish a unique filename');
  assert.deepEqual(ambiguous.missingNames,['1.jpg']);

  const invalid = makeSite({},{});
  await assert.rejects(reconcileManualUploadedPhotos({site:invalid,date,files:allFiles,allFiles,
    fileHashes:{...fileHashes,'1.jpg':hash('changed')}}), /哈希不同/);
  assert.equal(invalid.calls.length,0,'changed local bytes are rejected before browser queries');

  // Persistence is incremental even if the second list cannot be queried.
  const interrupted = makeSite({tablet:[{id:'t1',kind:'tablet',url:'one'}]}, {'one':bytes[0]});
  const query = interrupted.queryUploadedPhotoReferences;
  interrupted.queryUploadedPhotoReferences = async function(actualDate,kind) {
    if (kind === 'lamp') {
      assert.deepEqual(this.saved.map((item) => item.name),['1.jpg']);
      throw Error('navigation interrupted');
    }
    return query.call(this,actualDate,kind);
  };
  await assert.rejects(reconcileManualUploadedPhotos({site:interrupted,date,files:allFiles,fileHashes,
    onMatch:async(item) => interrupted.saved.push(item)}), /navigation interrupted/);
  assert.deepEqual(interrupted.saved.map((item) => item.name),['1.jpg']);
  assert.equal(interrupted.closed,1);

  const concurrent = makeSite({tablet:[{id:'t1',kind:'tablet',url:'one'}]}, {'one':bytes[0]});
  concurrent.readUploadedPhotoBytes = async () => { fs.writeFileSync(allFiles[0],bytes[1]); return bytes[0]; };
  await assert.rejects(reconcileManualUploadedPhotos({site:concurrent,date,files:[allFiles[0]],allFiles,fileHashes}), /回读期间发生变化/);
  assert.equal(concurrent.closed,1);
  console.log('Manual upload per-file read-only reconciliation regression PASS');
} finally {
  const actual = fs.realpathSync(temp), parent = fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(actual).toLowerCase(),parent.toLowerCase());
  assert.ok(path.basename(actual).startsWith('qifu-manual-reconcile-test-'));
  fs.rmSync(actual,{recursive:true,force:true});
}
