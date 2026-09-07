import assert from 'node:assert/strict';
import {finishScenePasses, waitForUploadOrderOutcome} from '../src/photo-online.mjs';
const pause=async()=>{};
let reads=0;
const outcome=await waitForUploadOrderOutcome(async()=>({state:++reads<3?'none-uploaded':'all-uploaded'}),{sleepFn:pause});
assert.equal(outcome.state,'all-uploaded');
assert.equal(reads,3);
assert.equal((await waitForUploadOrderOutcome(async()=>({state:'none-uploaded'}),{sleepFn:pause})).state,'none-uploaded');
let passes=0, uploads=0;
const sceneSite={
  async uploadSceneMode(){uploads++;return{skipped:passes===0,selectedCount:passes===0?0:125};},
  async countUploadedWithoutScene(){return ++passes===1?250:0;},
};
await finishScenePasses(sceneSite,'2026-09-05',[['water',[]],['lamp',[]]],{expectedPhotoDir:'fixture',sleepFn:pause});
assert.equal(passes,2);assert.equal(uploads,4);
await assert.rejects(()=>finishScenePasses({...sceneSite,countUploadedWithoutScene:async()=>250},'2026-09-05',[],{sleepFn:pause}),/场景图未上传/);
await assert.rejects(()=>finishScenePasses({...sceneSite,uploadSceneMode:async()=>{throw new Error('query invalid');}},'2026-09-05',[['lamp',[]]],{sleepFn:pause}),/query invalid/);
console.log('Photo online recovery regressions PASS');
