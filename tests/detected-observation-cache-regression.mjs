import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {readDetectedObservation} from '../src/detected-observation-cache.mjs';
import {summarizeDetectedCodeRead} from '../src/photo-prepare.mjs';
const source=Buffer.from('generated-source'),fingerprint='a'.repeat(64),runtimeFingerprint='b'.repeat(64);
const crop={left:10,top:10,width:50,height:12};
function observation(){
  const observations=[],independent=[],readings=[];
  for(const engine of ['paddle','tesseract'])for(const padding of [.45,.75]){
    const confidence=engine==='paddle'?.9:85;
    const row={engine,padding,index:0,crop:{...crop},confidence,codeCount:1,errorCode:null,incompleteTailObserved:false};
    readings.push(row);
    (engine==='paddle'?observations:independent).push({engine,padding,index:0,crop:{...crop},confidence,
      prefix:'269',number:168,fullCode:'269-1-168',physicalCodeExtent:'unverified'});
  }
  return {regions:1,observations,independent,readings,coverage:{kind:'detected-horizontal-regions',eligibleRegions:1,
    processedRegions:1,completed:true},errors:0,incompleteTailObserved:false,sourceDimensions:{width:200,height:100},
    engines:2,confirmed:168,bindingVerified:false,seconds:2};
}
async function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-raw-observation-test-'));let calls=0;
  const read=async()=>{calls++;return observation();};
  const options={cacheDir:dir,source,fingerprint,runtimeFingerprint,prefix:'269',maxRegions:100,read};
  try{await fn(options,()=>calls);}finally{
    assert.equal(path.dirname(fs.realpathSync(dir)).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(dir).startsWith('qifu-raw-observation-test-'));fs.rmSync(dir,{recursive:true,force:true});
  }
}
test('completed raw code evidence survives restart without caching a number decision',async()=>fixture(async(o,calls)=>{
  const first=await readDetectedObservation(o),second=await readDetectedObservation(o);
  assert.equal(calls(),1);assert.equal(first.cacheHit,false);assert.equal(second.cacheHit,true);
  assert.equal(second.observation.confirmed,null);assert.equal(second.observation.bindingVerified,false);
  assert.deepEqual(first.observation,second.observation);
  assert.equal(summarizeDetectedCodeRead(second.observation,'269',new Set([168])).number,168);
  assert.equal(summarizeDetectedCodeRead(second.observation,'269',new Set([169])).number,null);
}));
test('changed bytes, code, runtime, prefix or region budget invalidate raw observation cache',async()=>fixture(async(o,calls)=>{
  await readDetectedObservation(o);
  for(const change of [{source:Buffer.from('new')},{fingerprint:'c'.repeat(64)},{runtimeFingerprint:'d'.repeat(64)},
    {prefix:'268'},{maxRegions:99}])assert.equal((await readDetectedObservation({...o,...change})).cacheHit,false);
  assert.equal(calls(),6);
}));
test('mutated returned evidence cannot poison a later read',async()=>fixture(async(o)=>{
  const first=await readDetectedObservation(o);first.observation.observations[0].fullCode='269-1-169';
  const second=await readDetectedObservation(o);assert.equal(second.observation.observations[0].fullCode,'269-1-168');
}));
test('partial, failed, single-engine and malformed evidence are never reused',async()=>fixture(async(o)=>{
  let caseIndex=0;
  for(const mutate of [r=>r.coverage.completed=false,r=>r.errors=1,r=>r.engines=1,r=>r.readings.pop(),
    r=>r.readings[0].errorCode='failed',r=>r.readings[0].crop.width=0,r=>r.bindingVerified=true,
    r=>r.observations[0].number=169,r=>r.readings[0].codeCount=0,r=>r.sourceDimensions.width=1]){
    const r=observation();mutate(r);let calls=0;
    const options={...o,source:Buffer.from(String(caseIndex++)),read:async()=>{calls++;return r;}};
    await readDetectedObservation(options);assert.equal((await readDetectedObservation(options)).cacheHit,false);assert.equal(calls,2);
  }
}));
test('weak, contrary and incomplete-tail observations survive cache unchanged and remain blocked',async()=>fixture(async(o)=>{
  for(const mutate of [r=>{r.independent[0].prefix='268';r.independent[0].fullCode='268-1-168';},
    r=>{r.independent.forEach(x=>x.confidence=10);r.readings.filter(x=>x.engine==='tesseract').forEach(x=>x.confidence=10);},
    r=>r.incompleteTailObserved=true]){
    const r=observation();mutate(r);const options={...o,source:Buffer.from(JSON.stringify(r)),read:async()=>r};
    const first=await readDetectedObservation(options),second=await readDetectedObservation(options);
    assert.equal(second.cacheHit,true);assert.deepEqual(first.observation,second.observation);
    assert.equal(summarizeDetectedCodeRead(second.observation,'269',new Set([168])).number,null);
  }
}));
test('malformed or altered cache is preserved and treated as a miss',async()=>fixture(async(o,calls)=>{
  await readDetectedObservation(o);const file=path.join(o.cacheDir,fs.readdirSync(o.cacheDir)[0]);
  fs.writeFileSync(file,'{broken');assert.equal((await readDetectedObservation(o)).cacheHit,false);assert.equal(calls(),2);
  assert(fs.readdirSync(o.cacheDir).some(name=>name.includes('.rejected-')));
  const entry=JSON.parse(fs.readFileSync(file));entry.observation.independent.pop();fs.writeFileSync(file,JSON.stringify(entry));
  assert.equal((await readDetectedObservation(o)).cacheHit,false);assert.equal(calls(),3);
}));
test('unwritable cache or unavailable identity never prevents a fresh read',async()=>fixture(async(o)=>{
  const file=path.join(o.cacheDir,'regular-file');fs.writeFileSync(file,'unchanged');
  assert.equal((await readDetectedObservation({...o,cacheDir:file})).cacheHit,false);
  assert.equal((await readDetectedObservation({...o,runtimeFingerprint:null})).cacheHit,false);
  assert.equal(fs.readFileSync(file,'utf8'),'unchanged');
}));
test('blank but complete detector evidence can resume without manufacturing a number',async()=>fixture(async(o)=>{
  const r=observation();r.regions=0;r.observations=[];r.independent=[];r.readings=[];
  r.coverage.eligibleRegions=0;r.coverage.processedRegions=0;r.confirmed=null;
  const options={...o,read:async()=>r};await readDetectedObservation(options);
  const saved=await readDetectedObservation(options);assert.equal(saved.cacheHit,true);
  assert.equal(summarizeDetectedCodeRead(saved.observation,'269',new Set([168])).number,null);
}));
