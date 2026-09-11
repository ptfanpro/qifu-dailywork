import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readDetectedCodesWithScaleReview,validDetectedCodeReview} from '../src/detected-code-reader.mjs';
import {summarizeDetectedCodeRead,photoCodeAuditBlockReason} from '../src/photo-prepare.mjs';
import {readDetectedObservation} from '../src/detected-observation-cache.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';

const source=Buffer.from('synthetic detector input, not customer pixels');
const original={info:{width:1800,height:1350,channels:3},data:Buffer.alloc(1800*1350*3,255)};
const region={left:.2,top:.2,width:.3,height:.02,score:.99};
const good={text:'269-1-168',confidence:.95},answer={text:'269-1-168',confidence:85},blank={text:'',confidence:0};
async function collect({early=Array(8).fill(blank),later=[answer,answer],failDetection=false,width=1800}={}) {
 let calls=0;const options=[];
 const worker={recognize:async()=>{const r=[...early,...later][calls++]||blank;if(r instanceof Error)throw r;return {data:r};},setParameters:async()=>{}};
 const detector={detect:async(bytes,opt)=>{assert.deepEqual(bytes,source);options.push(opt);
  if(options.length===2&&failDetection)throw Error('private failure text');
  return {regions:[region],original:width===1800?original:{...original,info:{...original.info,width},data:Buffer.alloc(width*1350*3,255)}};
 }};
 const read=await readDetectedCodesWithScaleReview(detector,null,source,'269',{worker,recognizeLine:async()=>good,maxRegions:100});
 return {read,options,calls};
}

test('unconfirmed whole-frame code gets one larger-scale complete reading; original evidence remains',async()=>{
 const {read,options,calls}=await collect();
 assert.deepEqual(options,[undefined,{maxSide:2048}]);assert.equal(calls,10);
 assert.equal(read.independent.length,0);assert.equal(read.observations.length,2);
 assert.equal(read.nativeScaleReview.read.independent.length,2);
 assert.equal(read.nativeScaleReview.read.inputSha256,read.inputSha256);
 const review=summarizeDetectedCodeRead(read,'269',new Set([168]));
 assert.equal(review.number,168);assert.equal(review.reason,null);
 assert.equal(review.observations.length,6);assert.equal(review.evidence.bindingVerified,false);
 assert.equal(read.bindingVerified,false);
 assert.equal(photoCodeAuditBlockReason({number:168,detectedCodeRead:{...read,expectedPrefix:'269'}}),null);
 assert.ok(photoCodeAuditBlockReason({number:169,detectedCodeRead:{...read,expectedPrefix:'269'}}));
});

test('scale review skips fast successes, small inputs and any original conflict, fragment or failure',async()=>{
 for(const setting of [{early:[answer,answer]},{width:1400},
  {early:[{text:'268-1-168',confidence:0},blank]},
  {early:[{text:'269-1-169',confidence:0},blank]},
  {early:[{text:'269-1-16 8',confidence:80},blank]},
  {early:[new Error('private details'),blank]}]) {
  const {read,options}=await collect(setting);assert.equal(options.length,1);
  assert.equal(read.nativeScaleReview,undefined);
 }
});

test('new-scale disagreement, incomplete tail, empty result and reader failure never turn into success',async()=>{
 for(const setting of [{later:[{text:'268-1-168',confidence:0},answer]},
  {later:[{text:'269-1-169',confidence:0},answer]},
  {later:[{text:'269-1-16 8',confidence:80},answer]},
  {later:[blank,blank]},{later:[new Error('private details'),answer]},{failDetection:true}]){
  const {read,options}=await collect(setting);assert.equal(options.length,2);
  assert.equal(summarizeDetectedCodeRead(read,'269',new Set([168])).number,null);
  assert.equal(read.observations.length,2,'original raw evidence is never erased');
  assert.ok(!JSON.stringify(read).includes('private details'));
 }
});

test('scale evidence binds original observations, bytes, dimensions, recipe and full coverage',async()=>{
 const {read}=await collect();assert.equal(validDetectedCodeReview(read),true);
 for(const mutate of [r=>r.nativeScaleReview.maxSide=4096,r=>r.nativeScaleReview.recipe='unknown',
  r=>r.nativeScaleReview.baseReadSha256='0'.repeat(64),r=>r.inputSha256='0'.repeat(64),
  r=>r.nativeScaleReview.read.inputSha256='1'.repeat(64),r=>r.nativeScaleReview.read.sourceDimensions.width++,
  r=>r.nativeScaleReview.read.nativeScaleReview={},r=>r.nativeScaleReview.completed=false,
  r=>r.nativeScaleReview.read.coverage.completed=false,r=>r.nativeScaleReview.read.coverage.processedRegions=0,
  r=>r.observations[0].fullCode='269-1-169',r=>r.nativeScaleReview.read.independent[0].crop.width=-1]){
  const broken=structuredClone(read);mutate(broken);
  assert.equal(summarizeDetectedCodeRead(broken,'269',new Set([168])).number,null);
 }
 assert.equal(summarizeDetectedCodeRead(read,'269',new Set([169])).number,null);
});

test('raw cache retains both scale observations across resume and cannot wash away a contrary supplement',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-scale-cache-'));
 try{
  const {read}=await collect();let calls=0;
  const request={cacheDir:dir,source,fingerprint:'a'.repeat(64),runtimeFingerprint:'b'.repeat(64),prefix:'269',maxRegions:100,
   read:async()=>{calls++;return structuredClone(read);}};
  const first=await readDetectedObservation(request),second=await readDetectedObservation(request);
  assert.equal(calls,1);assert.equal(first.cacheHit,false);assert.equal(second.cacheHit,true);
  assert.equal(second.observation.nativeScaleReview.read.confirmed,null);
  assert.equal(summarizeDetectedCodeRead(second.observation,'269',new Set([168])).number,168);
  const failed=(await collect({later:[{text:'269-1-169',confidence:0},answer]})).read;
  const third=await readDetectedObservation({...request,fingerprint:'c'.repeat(64),read:async()=>failed});
  const fourth=await readDetectedObservation({...request,fingerprint:'c'.repeat(64),read:async()=>{throw Error('must reuse raw contrary evidence');}});
  assert.equal(fourth.cacheHit,true);
  assert.equal(summarizeDetectedCodeRead(third.observation,'269',new Set([168])).number,null);
  assert.equal(summarizeDetectedCodeRead(fourth.observation,'269',new Set([168])).number,null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
