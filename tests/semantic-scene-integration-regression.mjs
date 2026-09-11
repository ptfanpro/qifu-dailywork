import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {isLikelyScene,classifyScenes} from '../src/photo-prepare.mjs';
import {policyObservation} from './fixtures/semantic-policy.mjs';
import {counterexamples} from './experiments/scene-semantic-counterexamples.mjs';
import {createSemanticSceneService} from '../src/scene-semantic-service.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const HEAD='363faa187eacfc3535a7b409f7d8b68dd97a7a1e8e1a0e392ba6c18c3d2baa36';

const withRole=(item,role)=>({...item,sourceSha256:'a'.repeat(64),semanticRoleRead:policyObservation(role)});

test('semantic role supersedes contradictory global metrics, never visible code evidence',()=>{
  assert.equal(isLikelyScene(withRole(counterexamples[0],'paper')),false);
  for(const example of counterexamples.slice(1))assert.equal(isLikelyScene(withRole(example,'water')),true);
  const lamp=withRole(counterexamples[1],'lamp');
  for(const extra of [
    {codeAuditHistory:[{reason:'conflicting'}]}, {bodyReviewHistory:[{reason:'conflicting'}]},
    {detectedCodeRead:{errors:1,coverage:{completed:true}}},
    {detectedCodeRead:{errors:0,coverage:{completed:false}}},
    {detectedCodeRead:{errors:0,coverage:{completed:true},observations:[{number:12}]}},
    {detectedCodeRead:{errors:0,coverage:{completed:true},incompleteTailObserved:true}},
  ])assert.equal(isLikelyScene({...lamp,...extra}),false);
});
test('missing, ambiguous, tampered or stale semantic evidence cannot fall back to brightness',()=>{
  const base=withRole(counterexamples[1],'lamp');
  for(const semanticRoleRead of [null,{status:'unavailable'},policyObservation('mixed-scene'),
    {...base.semanticRoleRead,inputSha256:'b'.repeat(64)},
    {...base.semanticRoleRead,headSha256:'b'.repeat(64)},
    {...base.semanticRoleRead,candidate:'water'},
    {...base.semanticRoleRead,views:base.semanticRoleRead.views.slice(0,1)},
    {...base.semanticRoleRead,views:base.semanticRoleRead.views.map(v=>({...v,gap:99}))},
    {...base.semanticRoleRead,mayClearCodeConflict:true},
  ])assert.equal(isLikelyScene({...base,semanticRoleRead}),false);
});
test('scene allocation uses bound semantic observations and rechecks source bytes',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-semantic-plan-test-'));
  const file=path.join(dir,'arbitrary.jpg');const bytes=Buffer.from('policy fixture, no real image');
  try {
    fs.writeFileSync(file,bytes);
    const item={...withRole(counterexamples[1],'water'),file,sourceSha256:sha(bytes),semanticRoleRead:policyObservation('water',sha(bytes))};
    const options={recognizedByFile:new Map([[file,item]])};
    const result=await classifyScenes([file],new Set(),options);
    assert.deepEqual(result.assignments.map(a=>[a.targetName,a.kind]),[['2.5.jpg','scene-water']]);
    assert.equal(result.assignments[0].evidence.semanticRoleRead.inputSha256,sha(bytes));
    assert.equal((await classifyScenes([file],new Set(['2.5.jpg','2.6.jpg']),options)).assignments.length,0);
    fs.writeFileSync(file,'changed');
    assert.equal((await classifyScenes([file],new Set(),options)).assignments.length,0);
    assert.equal((await classifyScenes([file],new Set())).assignments.length,0,'missing observations must not trigger old scoring');
  }finally{fs.unlinkSync(file);fs.rmdirSync(dir);}
});
test('semantic planning session is lazy, shared, explicitly disposed, and bound to bytes',async()=>{
  let loads=0,reads=0,released=0;
  const service=createSemanticSceneService({appRoot:'synthetic-app',readerFactory:async options=>{
    loads++;assert.equal(options.expectedHeadSha256,HEAD);
    return {read:async bytes=>{reads++;return policyObservation('water',sha(bytes));},release:async()=>released++};
  }});
  assert.equal(loads,0,'GUI/session construction must not load the encoder');
  const bytes=Buffer.from('before'),expected=sha(bytes),pending=service.read(bytes);
  bytes.fill(0);assert.equal((await pending).inputSha256,expected);
  await service.read(Buffer.from('another'));assert.equal(loads,1);assert.equal(reads,2);
  await service.release();await service.release();assert.equal(released,1);
  await assert.rejects(service.read(bytes),/closed/);
});
test('unavailable or invalid semantic model never retries per photo or trusts a forged role',async()=>{
  let loads=0;
  const absent=createSemanticSceneService({appRoot:'synthetic-app',readerFactory:async()=>{loads++;throw Error('private path must not escape');}});
  for(let i=0;i<3;i++){
    const result=await absent.read(Buffer.from('source'));
    assert.equal(result.status,'unavailable');assert.equal(result.candidate,null);
    assert.doesNotMatch(JSON.stringify(result),/private path/);
  }
  await absent.release();assert.equal(loads,1);assert.equal(absent.stats.unavailable,3);
  const forged=createSemanticSceneService({appRoot:'synthetic-app',readerFactory:async()=>({
    read:async bytes=>({...policyObservation('water',sha(bytes)),headSha256:'b'.repeat(64)}),release:async()=>{},
  })});
  assert.equal((await forged.read(Buffer.from('source'))).status,'unavailable');await forged.release();
});
