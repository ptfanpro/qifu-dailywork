import test from 'node:test';
import assert from 'node:assert/strict';
import {createBalancedReferenceRoleClassifier} from './balanced-reference-role-reader.mjs';
import {createReferenceRoleClassifier,REFERENCE_ROLES} from './reference-role-reader.mjs';
const sha=n=>n.toString(16).padStart(64,'0');
const v=(a,b=0)=>Array.from({length:512},(_,i)=>i===0?a:i===1?b:0);
const views=(a,b=a)=>[{view:'center-crop',embedding:a},{view:'full-frame',embedding:b}];
const identity={fingerprint:sha(1000)};
const calibration=()=>REFERENCE_ROLES.flatMap((role,k)=>Array.from({length:3},(_,i)=>({
 sha256:sha(k*3+i+1),date:`2026-01-0${i+1}`,reviewed:true,role,
 views:views(v(...[[.8,.6],[-1,0],[1,0]][k]))})));
const query=(a=v(1),b=a)=>({sha256:sha(100),date:'2026-02-01',views:views(a,b)});
test('balanced roles: equal distinct-date support removes global neighbor-density constraint',()=>{
 const rows=calibration(); rows[8].views=views(v(.7,.714));
 assert.equal(createReferenceRoleClassifier(rows,identity).predict(query()).candidate,null);
 const result=createBalancedReferenceRoleClassifier(rows,identity).predict(query());
 assert.equal(result.candidate,'water');
 for(const view of result.views)for(const rank of view.ranking){
  assert.equal(rank.support.length,2); assert.equal(new Set(rank.support.map(x=>x.date)).size,2);
 }
 for(const key of ['semanticVerified','bindingVerified','mayAssignNumber','mayClearCodeConflict','mayUploadScene'])assert.equal(result[key],false);
});
test('balanced roles: same-date duplicate examples cannot count as new date support',()=>{
 const rows=calibration(),before=createBalancedReferenceRoleClassifier(rows,identity).predict(query());
 const repeated=[...rows,...Array.from({length:40},(_,i)=>({...structuredClone(rows[0]),sha256:sha(200+i)}))];
 const after=createBalancedReferenceRoleClassifier(repeated,identity).predict(query());
 assert.deepEqual(after.views.map(x=>x.ranking.map(y=>[y.role,y.score])),before.views.map(x=>x.ranking.map(y=>[y.role,y.score])));
 assert.equal(after.candidate,before.candidate);
});
test('balanced roles: view disagreement, ties, leakage and invalid evidence stay rejected',()=>{
 const rows=calibration(),model=createBalancedReferenceRoleClassifier(rows,identity);
 assert.equal(model.predict(query(v(1),v(-1))).candidate,null);
 const z=Array.from({length:512},(_,i)=>Number(i===2));
 assert.equal(model.predict(query(z)).candidate,null);
 assert.throws(()=>model.predict({...query(),sha256:rows[0].sha256}),/overlaps/);
 assert.throws(()=>model.predict({...query(),date:rows[0].date}),/overlaps/);
 assert.throws(()=>model.predict({...query(),views:[]}),/Incomplete/);
 for(const mutate of [r=>r[0].reviewed=false,r=>r.filter(x=>x.role==='water').forEach(x=>x.date='2026-01-01'),
  r=>r[0].views[0].embedding[0]=NaN]){
  const copy=calibration();mutate(copy);assert.throws(()=>createBalancedReferenceRoleClassifier(copy,identity));
 }
});
test('balanced roles: model identity is order-stable, immutable and independent of query answers',()=>{
 const rows=calibration(),model=createBalancedReferenceRoleClassifier(rows,identity);
 assert.equal(createBalancedReferenceRoleClassifier([...rows].reverse(),identity).identity.fingerprint,model.identity.fingerprint);
 const before=model.predict(query());rows[0].role='water';rows[0].views[0].embedding.fill(0);
 assert.deepEqual(model.predict({...query(),filename:'water.jpg',referenceLabel:'paper',number:123}),before);
 assert.notEqual(model.identity.fingerprint,createReferenceRoleClassifier(calibration(),identity).identity.fingerprint);
});
