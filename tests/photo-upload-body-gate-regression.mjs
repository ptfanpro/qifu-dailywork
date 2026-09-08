import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mustRebuildPhotoPlan,assertWritePlanReady} from '../src/photo-plan-gate.mjs';
const stale={indexReusable:false,standardizedOnly:false,imageCount:18};
assert.equal(mustRebuildPhotoPlan({...stale,action:'photo-upload'}),true,'mixed inbox must not bypass a stale plan before upload');
assert.equal(mustRebuildPhotoPlan({...stale,action:'photo-scenes'}),true,'scene/status writes also require current scope');
assert.equal(mustRebuildPhotoPlan({...stale,action:'photo-scan'}),false,'initialization must not OCR raw images');
assert.equal(mustRebuildPhotoPlan({...stale,indexReusable:true,action:'photo-upload'}),false);
assert.equal(mustRebuildPhotoPlan({...stale,standardizedOnly:true,action:'photo-scan'}),true);
assert.equal(mustRebuildPhotoPlan({...stale,imageCount:0,action:'photo-upload'}),false);
console.log('Mixed inbox write-stage PDF/body gate PASS');
const write={imageCount:18,action:'photo-upload'};
for(const plan of [null,{safeToApply:true,allowedBlessingNumbers:[8]},
  {safeToApply:false,allowedBlessingNumbers:[],bodyClaimReview:{status:'not-needed'}},
  {safeToApply:true,issues:['conflict'],allowedBlessingNumbers:[],bodyClaimReview:{status:'not-needed'}}]) {
  assert.throws(()=>assertWritePlanReady(plan,write),/未上传或修改订单/);
}
assert.doesNotThrow(()=>assertWritePlanReady({safeToApply:true,issues:[],allowedBlessingNumbers:[],bodyClaimReview:{status:'veto-only-not-order-binding'}},write));
assert.doesNotThrow(()=>assertWritePlanReady(null,{imageCount:18,action:'photo-scan'}));
const runner=fs.readFileSync(new URL('../src/runner.mjs',import.meta.url),'utf8');
assert.match(runner,/mustRebuildPhotoPlan\(\{indexReusable:allowedBlessingNumbers!==null/);
assert.ok(runner.indexOf('assertWritePlanReady(cachedPhotoPlan')<runner.indexOf('const manifest = await scanPhotoWorkday(root,photoDate'));
