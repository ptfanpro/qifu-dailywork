import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runReleaseGates} from './release-gates.mjs';

test('release command cannot omit known scene semantic failures',()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));
  assert.equal(pkg.scripts['test:release'],'node tests/release-gates.mjs');
});
test('known defect failure stops release checks, even when ordinary tests would pass',async()=>{
  const invoked=[];
  const result=await runReleaseGates({platform:'win32',run:async stage=>{
    invoked.push(stage.id);return {status:stage.id==='scene-semantics'?1:0};
  }});
  assert.equal(result.passed,false);assert.equal(result.failedStage,'scene-semantics');
  assert.deepEqual(invoked,['scene-semantics']);assert.equal(result.releaseAccepted,false);
});
test('missing exit status and execution errors never become a passing gate',async()=>{
  for(const run of [async()=>({status:null}),async()=>({}),async()=>{throw Error('synthetic');}]){
    const result=await runReleaseGates({platform:'win32',run});
    assert.equal(result.passed,false);assert.equal(result.failedStage,'scene-semantics');
  }
});
test('Windows full suite is mandatory and green tests alone do not claim annual acceptance',async()=>{
  const invoked=[];
  const result=await runReleaseGates({platform:'win32',run:async stage=>{invoked.push(stage.id);return {status:0};}});
  assert.deepEqual(invoked,['scene-semantics','layout-runtime-assets','windows-full-suite']);assert.equal(result.passed,true);
  assert.equal(result.releaseAccepted,false);
  const unsupported=await runReleaseGates({platform:'linux',run:async()=>{throw Error('must not run');}});
  assert.equal(unsupported.passed,false);assert.equal(unsupported.failedStage,'windows-required');
});
test('missing or broken app-local layout runtime blocks release before the Windows suite',async()=>{
  const invoked=[];
  const result=await runReleaseGates({platform:'win32',run:async stage=>{
    invoked.push(stage.id);
    if(stage.id==='layout-runtime-assets'){
      assert.equal(stage.args[0],'tests/layout-runtime-integration.mjs');
      assert.match(stage.args[1],/runtime[\\/]layout-python-v1$/);
      return {status:1};
    }
    return {status:0};
  }});
  assert.equal(result.passed,false);assert.equal(result.failedStage,'layout-runtime-assets');
  assert.equal(result.releaseAccepted,false);assert.deepEqual(invoked,['scene-semantics','layout-runtime-assets']);
});
