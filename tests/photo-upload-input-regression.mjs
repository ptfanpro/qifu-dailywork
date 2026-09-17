import assert from 'node:assert/strict';
import fs from 'node:fs';
import {photoFilesMatchPlan,photoFilesExactlyMatchPlan,trustedPreparedOutputs,retainVerifiedUploadEvidence,assertPhotoFilesMatchPlan} from '../src/photo-plan-gate.mjs';
const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
const photoDir='C:/synthetic/day/1';
const plan={businessDate:'2026-01-01',createdAt:'2026-01-02T01:00:00Z',photoDir,
  photoInputBinding:{schemaVersion:1,files:[{name:'8.jpg',sha256:a},{name:'raw.jpg',sha256:b}]},
  assignments:[],duplicateSources:[]};
assert.equal(photoFilesMatchPlan(plan,null,[{name:'8.jpg',sha256:c}]),false,'same-name replacement must not reuse recognition');
assert.equal(photoFilesMatchPlan(plan,null,[{name:'8.jpg',sha256:a}]),true);
assert.equal(photoFilesMatchPlan(plan,null,[{name:'9.jpg',sha256:a}]),false,'new numeric photo needs recognition');
assert.equal(photoFilesMatchPlan(plan,null,[{name:'8.jpg',sha256:a},{name:'new-raw.jpg',sha256:c}]),true,'unassigned raw addition does not change upload identity');
assert.equal(photoFilesMatchPlan(null,null,[{name:'8.jpg',sha256:a}]),false);
assert.equal(photoFilesMatchPlan(plan,null,[{name:'8.jpg',sha256:null}]),false);
assert.equal(photoFilesMatchPlan(plan,null,[{name:'../8.jpg',sha256:a}]),false);
assert.equal(photoFilesMatchPlan(plan,null,[{name:'8.jpg',sha256:a},{name:'8.JPG',sha256:a}]),false);
const prepared={...plan,assignments:[{source:photoDir+'/raw.jpg',targetName:'9.jpg',kind:'blessing'}]};
const receipt={businessDate:plan.businessDate,completedAt:'2026-01-02T01:01:00Z',duplicates:[],
  files:[{source:photoDir+'/raw.jpg',targetName:'9.jpg',kind:'blessing',beforeSha256:b,afterSha256:c}]};
const current=[{name:'8.jpg',sha256:a},{name:'9.jpg',sha256:c}];
assert.equal(photoFilesMatchPlan(prepared,receipt,current),true,'verified preparation output can resume without OCR');
assert.equal(photoFilesExactlyMatchPlan({...prepared,allowedBlessingNumbers:[8,9]},receipt,current),true,
  'an exact committed preparation checkpoint may skip repeat OCR');
assert.equal(photoFilesExactlyMatchPlan({...prepared,allowedBlessingNumbers:[8,9]},receipt,[...current,{name:'new-raw.jpg',sha256:b}]),false,
  'a newly arrived raw photo must enter supplement recognition');
assert.equal(photoFilesExactlyMatchPlan({...prepared,allowedBlessingNumbers:[8,9]},receipt,current.slice(1)),false,
  'a deleted prior file is not an exact resume');
assert.equal(photoFilesExactlyMatchPlan({...prepared,allowedBlessingNumbers:[]},{...receipt,blessingCount:1},current),false,
  'a weaker retry plan cannot supersede a stronger completed receipt');
assert.deepEqual(trustedPreparedOutputs({...prepared,allowedBlessingNumbers:[8,9]},receipt,current),
  [{name:'9.jpg',sha256:c,kind:'blessing',number:9}],
  'supplement recognition receives only source/hash/receipt-bound prior outputs');
assert.deepEqual(trustedPreparedOutputs({...prepared,allowedBlessingNumbers:[8]},receipt,current),[],
  'a numeric output outside the prior allowed PDF scope is never trusted');
const uploadEvidence={
  '8.jpg':{sha256:a,uploadedAt:'2026-01-02T01:02:00Z'},
  '9.jpg':{sha256:c,uploadedAt:'2026-01-02T01:02:00Z'},
};
assert.deepEqual(retainVerifiedUploadEvidence(uploadEvidence,current),uploadEvidence,
  'a weaker manifest cannot delete prior uploads while their exact bytes remain');
assert.deepEqual(retainVerifiedUploadEvidence(uploadEvidence,[{name:'8.jpg',sha256:a},{name:'9.jpg',sha256:b}]),
  {'8.jpg':uploadEvidence['8.jpg']},'changed bytes revoke only that file, not unrelated upload evidence');
for(const altered of [null,{...receipt,businessDate:'2026-01-02'},
  {...receipt,completedAt:'2026-01-02T00:59:00Z'},
  {...receipt,files:[{...receipt.files[0],beforeSha256:a}]},
  {...receipt,files:[{...receipt.files[0],source:'C:/other/raw.jpg'}]},
  {...receipt,files:[{...receipt.files[0],kind:'scene-water'}]},
  {...receipt,files:[receipt.files[0],receipt.files[0]]}]) {
  assert.equal(photoFilesMatchPlan(prepared,altered,current),false,'unbound old/partial receipt must not bless new bytes');
}
const normalization={...plan,assignments:[{source:photoDir+'/8.jpg',targetName:'8.jpg',kind:'blessing'}]};
const normalizedReceipt={...receipt,files:[{source:photoDir+'/8.jpg',targetName:'8.jpg',kind:'blessing',beforeSha256:a,afterSha256:c}]};
assert.equal(photoFilesMatchPlan(normalization,normalizedReceipt,[{name:'8.jpg',sha256:c}]),true);
assert.equal(photoFilesMatchPlan(normalization,normalizedReceipt,[{name:'8.jpg',sha256:b}]),false);
const scene={...plan,assignments:[{source:photoDir+'/raw.jpg',targetName:'2.5.jpg',kind:'scene-water'}]};
const sceneReceipt={...receipt,files:[{...receipt.files[0],targetName:'2.5.jpg',kind:'scene-water'}]};
assert.equal(photoFilesMatchPlan(scene,sceneReceipt,[{name:'2.5.jpg',sha256:c}]),true);
assert.equal(photoFilesMatchPlan(scene,sceneReceipt,[{name:'2.5.jpg',sha256:b}]),false);
assert.throws(()=>assertPhotoFilesMatchPlan(plan,null,[{name:'8.jpg',sha256:c}]),/未上传或修改订单/);
assert.doesNotThrow(()=>assertPhotoFilesMatchPlan(prepared,receipt,current));
const renumber={...plan,assignments:[{source:photoDir+'/8.jpg',targetName:'9.jpg',kind:'blessing'}]};
assert.equal(photoFilesMatchPlan(renumber,null,[{name:'8.jpg',sha256:a}]),false,'pending renumber is not an upload permit for the old number');
const cycle={...plan,photoInputBinding:{schemaVersion:1,files:[{name:'8.jpg',sha256:a},{name:'9.jpg',sha256:b}]},
  assignments:[{source:photoDir+'/8.jpg',targetName:'9.jpg',kind:'blessing'},{source:photoDir+'/9.jpg',targetName:'8.jpg',kind:'blessing'}]};
const cycleReceipt={...receipt,files:[
  {source:photoDir+'/8.jpg',targetName:'9.jpg',kind:'blessing',beforeSha256:a,afterSha256:c},
  {source:photoDir+'/9.jpg',targetName:'8.jpg',kind:'blessing',beforeSha256:b,afterSha256:a}]};
assert.equal(photoFilesMatchPlan(cycle,cycleReceipt,[{name:'8.jpg',sha256:a},{name:'9.jpg',sha256:c}]),true);
assert.equal(photoFilesMatchPlan(cycle,{...cycleReceipt,files:cycleReceipt.files.slice(0,1)},current),false);
const withDuplicate={...prepared,photoInputBinding:{schemaVersion:1,files:[...plan.photoInputBinding.files,{name:'duplicate.jpg',sha256:b}]},
  duplicateSources:[{source:photoDir+'/duplicate.jpg'}]};
assert.equal(photoFilesMatchPlan(withDuplicate,{...receipt,duplicates:[{source:photoDir+'/duplicate.jpg',beforeSha256:b}]},current),true);
assert.equal(photoFilesMatchPlan(withDuplicate,{...receipt,duplicates:[]},current),false);
const runner=fs.readFileSync(new URL('../src/runner.mjs',import.meta.url),'utf8');
const planner=fs.readFileSync(new URL('../src/photo-prepare.mjs',import.meta.url),'utf8');
assert.match(runner,/indexReusable && photoIdentityMatches/);
assert.match(runner,/photoFilesExactlyMatchPlan\(previousPlan,previousPreparationReceipt,currentPhotoBinding\.files\)/);
assert.match(runner,/readOnlyRecheck\?'photo-recheck-plan\.json':'photo-prepare-plan\.json'/,
  'diagnostic recheck must not overwrite the operational checkpoint');
assert.match(runner,/retainVerifiedUploadEvidence\(previous\.uploadedFiles,currentPhotoInputBinding\.files\)/,
  'prior upload evidence is retained by actual bytes, not by a weaker manifest');
assert.match(planner,/!trustedPreparedByName\.has\(path\.basename\(file\)\.toLowerCase\(\)\)/,
  'supplement planning must not OCR unchanged receipt-bound numeric outputs');
const gatePosition=runner.indexOf('assertPhotoFilesMatchPlan(cachedPhotoPlan');
assert.ok(gatePosition>runner.indexOf('const manifest = await scanPhotoWorkday(root,photoDate'));
assert.ok(gatePosition<runner.indexOf('if (args.action === \'photo-upload\')'));
console.log('Upload recognition/source and exact preparation-output binding PASS');
