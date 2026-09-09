import test from 'node:test';
import assert from 'node:assert/strict';
import {createReferenceRoleClassifier,REFERENCE_ROLES,referenceExperimentFingerprint} from './reference-role-reader.mjs';
const sha=n=>n.toString(16).padStart(64,'0');
const vector=(axis)=>Array.from({length:512},(_,i)=>Number(i===axis));
const views=(a,b=a)=>[{view:'center-crop',embedding:vector(a)},{view:'full-frame',embedding:vector(b)}];
const references=()=>REFERENCE_ROLES.flatMap((role,k)=>Array.from({length:3},(_,i)=>({
  sha256:sha(k*3+i+1),date:i%2?'2026-01-02':'2026-01-01',role,reviewed:true,views:views(k)})));
const identity={fingerprint:sha(100)};
test('frozen reference roles: independent-image candidates have no business authority',()=>{
 const model=createReferenceRoleClassifier(references(),identity);
 for(let k=0;k<3;k++){
  const result=model.predict({sha256:sha(90+k),date:'2026-02-01',views:views(k)});
  assert.equal(result.candidate,REFERENCE_ROLES[k]);
  for(const key of ['semanticVerified','bindingVerified','mayAssignNumber','mayClearCodeConflict','mayUploadScene'])assert.equal(result[key],false);
 }
 assert.equal(model.predict({sha256:sha(90),date:'2026-02-01',views:views(0,2)}).candidate,null);
 assert.equal(model.predict({sha256:sha(90),date:'2026-02-01',views:views(30)}).candidate,null,'ties cannot fabricate a role');
});
test('reference identity: reject training leakage, unreviewed/duplicate labels and incomplete views',()=>{
 const model=createReferenceRoleClassifier(references(),identity);
 assert.throws(()=>model.predict({sha256:sha(1),date:'2026-02-01',views:views(0)}),/overlaps/);
 assert.throws(()=>model.predict({sha256:sha(90),date:'2026-01-02',views:views(0)}),/overlaps/);
 for(const mutate of [r=>r[0].reviewed=false,r=>r[0].role='blessing',r=>r[0].sha256=r[1].sha256,
   r=>r[0].views.pop(),r=>r[0].views[0].embedding[0]=NaN,r=>r.splice(0,1),r=>r[0].date='2026-02-30',
   r=>r.filter(x=>x.role==='water').forEach(x=>x.date='2026-01-01')]){
  const r=references();mutate(r);assert.throws(()=>createReferenceRoleClassifier(r,identity));
 }
 assert.throws(()=>model.predict({sha256:sha(90),date:'2026-02-01',views:[]}),/Incomplete/);
 assert.throws(()=>model.predict({sha256:sha(90),date:'2026-02-30',views:views(0)}),/invalid/);
});
test('experiment identity excludes run time and evaluation answers, includes source and reviewed references',()=>{
 const a={sourceFiles:[['b',sha(2)],['a',sha(1)]],calibrationLabelSha256:sha(3),model:{fingerprint:sha(4)}};
 assert.equal(referenceExperimentFingerprint(a),referenceExperimentFingerprint({...a,sourceFiles:[...a.sourceFiles].reverse(),startedAt:'later',evaluationLabels:['water']}));
 assert.notEqual(referenceExperimentFingerprint(a),referenceExperimentFingerprint({...a,calibrationLabelSha256:sha(5)}));
 assert.throws(()=>referenceExperimentFingerprint({...a,sourceFiles:[a.sourceFiles[0],a.sourceFiles[0]]}),/Incomplete/);
});
test('reference snapshot does not change with caller mutation or query metadata',()=>{
 const r=references(),model=createReferenceRoleClassifier(r,identity),f=model.identity.fingerprint;
 r[0].role='water';r[0].views[0].embedding.fill(0);
 const a=model.predict({sha256:sha(90),date:'2026-02-01',views:views(0)});
 const b=model.predict({sha256:sha(91),date:'2026-03-01',views:views(0),referenceLabel:'water',number:999});
 assert.deepEqual(a,b);assert.equal(a.candidate,'paper');assert.equal(a.fingerprint,f);
 assert.equal(createReferenceRoleClassifier(references(),identity).identity.fingerprint,f);
});
