// Offline hypothesis after the first global-neighbor experiment failed water recall.
// Equal support dates per role; not a probability, foreground proof or production gate.
import crypto from 'node:crypto';
import {createReferenceRoleClassifier,REFERENCE_ROLES} from './reference-role-reader.mjs';
import {CLIP_VIEWS,unitVector} from './clip-role-reader.mjs';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const SUPPORT_DATES=2,TIE_EPSILON=1e-6;
export function createBalancedReferenceRoleClassifier(calibration,encoderIdentity){
 const ordered=[...calibration].sort((a,b)=>String(a.sha256).localeCompare(String(b.sha256)));
 // Reuse exactly the audited reference/date/source/vector validation and leakage guards.
 const baseline=createReferenceRoleClassifier(ordered,encoderIdentity);
 const rows=ordered.map(r=>({date:r.date,sha256:r.sha256,role:r.role,
  vectors:Object.fromEntries(r.views.map(v=>[v.view,unitVector(v.embedding)]))}));
 const identity={schemaVersion:1,algorithm:'equal-role-two-distinct-date-support-v1',
  referenceFingerprint:baseline.identity.fingerprint,encoder:structuredClone(encoderIdentity),
  supportDates:SUPPORT_DATES,tieEpsilon:TIE_EPSILON,roles:REFERENCE_ROLES,views:CLIP_VIEWS};
 const fingerprint=hash(identity);
 return {identity:{...identity,fingerprint},predict(input){
  baseline.predict(input); // Validation only; its winner never filters the new observations.
  const query=Object.fromEntries(input.views.map(v=>[v.view,unitVector(v.embedding)]));
  const results=CLIP_VIEWS.map(view=>{
   const ranking=REFERENCE_ROLES.map(role=>{
    const byDate=new Map();
    for(const row of rows.filter(r=>r.role===role)){
     const cosine=query[view].reduce((n,x,i)=>n+x*row.vectors[view][i],0),old=byDate.get(row.date);
     if(!old||cosine>old.cosine||(cosine===old.cosine&&row.sha256<old.sourceSha256))
      byDate.set(row.date,{date:row.date,sourceSha256:row.sha256,cosine});
    }
    const support=[...byDate.values()].sort((a,b)=>b.cosine-a.cosine||a.date.localeCompare(b.date)).slice(0,SUPPORT_DATES);
    if(support.length!==SUPPORT_DATES)throw Error('Insufficient distinct-date support');
    return {role,score:support.reduce((n,r)=>n+r.cosine,0)/SUPPORT_DATES,support};
   }).sort((a,b)=>b.score-a.score||a.role.localeCompare(b.role));
   const margin=ranking[0].score-ranking[1].score;
   return {view,ranking,margin,candidate:margin>TIE_EPSILON?ranking[0].role:null};
  });
  const candidate=results[0].candidate&&results.every(r=>r.candidate===results[0].candidate)?results[0].candidate:null;
  return {fingerprint,candidate,views:results,semanticVerified:false,bindingVerified:false,
   mayAssignNumber:false,mayClearCodeConflict:false,mayUploadScene:false,
   note:'Equal distinct-date support is diagnostic; no absolute/open-set calibration or foreground verification.'};
 }};
}
