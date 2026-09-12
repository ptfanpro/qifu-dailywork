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
test('missing semantic model package blocks release even if semantic rule tests pass',async()=>{
  const invoked=[];
  const result=await runReleaseGates({platform:'win32',run:async stage=>{
    invoked.push(stage.id);
    if(stage.id==='semantic-package-assets') {
      assert.equal(stage.args[0],'tests/semantic-package-smoke.mjs');
      assert.ok(stage.args[1],'check the explicit application package, not a host fallback');
      return {status:1};
    }
    return {status:0};
  }});
  assert.equal(result.passed,false);assert.equal(result.failedStage,'semantic-package-assets');
  assert.deepEqual(invoked,['scene-semantics','semantic-package-assets']);assert.equal(result.releaseAccepted,false);
});
test('Windows full suite is mandatory and green tests alone do not claim annual acceptance',async()=>{
  const invoked=[];
  const result=await runReleaseGates({platform:'win32',run:async stage=>{
    invoked.push(stage.id);
    if(stage.id==='windows-full-suite'){
      assert.equal(stage.command,'powershell.exe');
      assert.deepEqual(stage.args,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','ui/Run-Tests.ps1']);
    }
    return {status:0};
  }});
  assert.deepEqual(invoked,['scene-semantics','semantic-package-assets','layout-runtime-assets','positioned-code-join','windows-full-suite']);assert.equal(result.passed,true);
  assert.equal(result.releaseAccepted,false);
  const unsupported=await runReleaseGates({platform:'linux',run:async()=>{throw Error('must not run');}});
  assert.equal(unsupported.passed,false);assert.equal(unsupported.failedStage,'windows-required');
});
test('positioned join/restart regression cannot be omitted from release',async()=>{
  const invoked=[];
  const result=await runReleaseGates({platform:'win32',run:async stage=>{
    invoked.push(stage.id);
    if(stage.id==='positioned-code-join'){
      assert.equal(stage.args[0],'tests/positioned-join-integration.mjs');
      return {status:1};
    }
    return {status:0};
  }});
  assert.equal(result.passed,false);assert.equal(result.failedStage,'positioned-code-join');
  assert.equal(result.releaseAccepted,false);assert.deepEqual(invoked,['scene-semantics','semantic-package-assets','layout-runtime-assets','positioned-code-join']);
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
  assert.equal(result.releaseAccepted,false);assert.deepEqual(invoked,['scene-semantics','semantic-package-assets','layout-runtime-assets']);
});
