import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isLikelyScene,diagnoseLegacySceneMetrics} from '../src/photo-prepare.mjs';
import {counterexamples,evaluateCounterexamples} from './experiments/scene-semantic-counterexamples.mjs';
import {policyObservation} from './fixtures/semantic-policy.mjs';

test('omitting semantic evidence must not reactivate old scene shortcuts',()=>{
  for(const sample of counterexamples){
    const before=structuredClone(sample);
    assert.equal(isLikelyScene(sample),false,'metric-only input cannot authorize scene entry');
    assert.equal(isLikelyScene({...sample,sourceSha256:'a'.repeat(64)}),false);
    assert.equal(isLikelyScene({...sample,semanticRoleRead:undefined}),false);
    assert.deepEqual(sample,before);
  }
  assert.equal(evaluateCounterexamples().failures,0);
  assert.equal(evaluateCounterexamples().legacyUnsafeHints,3,'old failures remain visible, not re-labelled as correct');
});

test('legacy metric diagnostics remain non-authorizing and cannot impersonate semantic evidence',()=>{
  for(const sample of counterexamples){
    const diagnostic=diagnoseLegacySceneMetrics(sample);
    assert.equal(diagnostic.mayAssign,false);
    assert.equal(diagnostic.maySkipCodeRecognition,false);
    assert.equal(diagnostic.mayAuthorizeUpload,false);
    assert.equal(Object.isFrozen(diagnostic),true);
    assert.equal(isLikelyScene({...sample,...diagnostic}),false);
    assert.equal(isLikelyScene({...sample,sourceSha256:'a'.repeat(64),semanticRoleRead:diagnostic}),false);
  }
  assert.equal(isLikelyScene(null),false);
  assert.equal(isLikelyScene(undefined),false);
});

test('safe scene entry retains water and lamp positives and paper/conflict vetoes',()=>{
  for(const role of ['water','lamp']){
    const item={...counterexamples[1],sourceSha256:'a'.repeat(64),semanticRoleRead:policyObservation(role)};
    assert.equal(isLikelyScene(item),true,'valid source-bound role remains eligible');
    assert.equal(isLikelyScene({...item,sourceSha256:'b'.repeat(64)}),false);
    assert.equal(isLikelyScene({...item,semanticRoleRead:policyObservation('paper')}),false);
    assert.equal(isLikelyScene({...item,semanticRoleRead:policyObservation('mixed-scene')}),false);
    assert.equal(isLikelyScene({...item,reliable:true,number:123,evidence:{method:'photo-code-multi-crop-consensus'}}),false);
    assert.equal(isLikelyScene({...item,codeAuditHistory:[{status:'conflicting'}]}),false);
    assert.equal(isLikelyScene({...item,bodyReviewHistory:[{status:'conflicting'}]}),false);
  }
});
