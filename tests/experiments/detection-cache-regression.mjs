import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sealDetectionRow,canReuseDetectionRow,detectionErrorCount} from './detection-cache.mjs';
const identity={sourceVersion:'a'.repeat(64),modelSha256:'b'.repeat(64),date:'2026-01-02',sha256:'c'.repeat(64)};
const readings=['paddle','tesseract'].flatMap(engine=>[.45,.75].map(padding=>({engine,index:0,padding,errorCode:null})));
const base={sha256:identity.sha256,sourceUnchanged:true,engines:2,errors:0,bindingVerified:false,confirmed:null,
 observations:[],independent:[],readings,regions:1,coverage:{eligibleRegions:1,processedRegions:1,completed:true}};
const valid=()=>sealDetectionRow(structuredClone(base),identity);
test('current complete unresolved evidence is reusable but never business binding',()=>{
 assert.equal(canReuseDetectionRow(valid(),identity,identity.sha256),true);
 assert.equal(valid().bindingVerified,false);
});
test('resume rejects legacy, another photo, date, source or model even in the same file',()=>{
 assert.equal(canReuseDetectionRow(base,identity,identity.sha256),false);
 for(const field of ['sourceVersion','modelSha256','date','sha256']){
  const changed={...identity,[field]:field==='date'?'2026-01-03':'d'.repeat(64)};
  assert.equal(canReuseDetectionRow(valid(),changed,identity.sha256),false,field);
 }
});
test('source must be freshly rehashed, not trusted from saved sourceUnchanged',()=>{
 assert.equal(canReuseDetectionRow(valid(),identity,'e'.repeat(64)),false);
 assert.equal(canReuseDetectionRow(sealDetectionRow({...base,sourceUnchanged:false},identity),identity,identity.sha256),false);
});
test('engine failures and missing reads are not cached success',()=>{
 const missing=sealDetectionRow({...base,readings:readings.slice(1)},identity);
 assert.equal(canReuseDetectionRow(missing,identity,identity.sha256),false);
 const failed=sealDetectionRow({...base,errors:1,coverage:{...base.coverage,completed:false},
  readings:readings.map((r,i)=>i? r:{...r,errorCode:'reader-unavailable'})},identity);
 assert.equal(canReuseDetectionRow(failed,identity,identity.sha256),false);
 const duplicate=sealDetectionRow({...base,readings:[readings[0],readings[0],...readings.slice(2)]},identity);
 assert.equal(canReuseDetectionRow(duplicate,identity,identity.sha256),false);
});
test('modified payload and incomplete coverage cannot become a confirmed result',()=>{
 const changed=valid();changed.confirmed=99;
 assert.equal(canReuseDetectionRow(changed,identity,identity.sha256),false);
 const truncated=sealDetectionRow({...base,confirmed:99,regions:301,coverage:{eligibleRegions:301,processedRegions:1,completed:false}},identity);
 assert.equal(canReuseDetectionRow(truncated,identity,identity.sha256),false);
 const limited=sealDetectionRow({...base,regions:1000,coverage:{...base.coverage,completed:false}},identity);
 assert.equal(canReuseDetectionRow(limited,identity,identity.sha256),true,'a completed bounded measurement may be reused as unresolved');
});
test('summary counts per-reading errors, not only top-level detector exceptions',()=>{
 assert.equal(detectionErrorCount([base,{...base,errors:1},{error:'detector-failed'}]),2);
});
