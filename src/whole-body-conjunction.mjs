// Feasibility screen only. It observes a conjunction in supplied body views;
// it cannot bind them to source bytes, waive any code audit or assign a page.
import crypto from 'node:crypto';
import {createBodyClaimAssessor} from './body-content-review.mjs';
import {validPositionedBodyViews} from './body-positioned-observation.mjs';
import {visualBodyViewNames} from './pdf-visual-body-evidence.mjs';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const id=p=>`${p.pdfSha256}:${p.pageNumber}`;
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const overlap=(a,b)=>Math.min(a.left+a.width,b.left+b.width)>Math.max(a.left,b.left)
 &&Math.min(a.top+a.height,b.top+b.height)>Math.max(a.top,b.top);
const result=(status,candidate=null)=>({schemaVersion:1,status,candidate,mayAssignNumber:false,mayClearCodeConflict:false});
function wholeFieldHash(text){
 if(/[\r\n\u2028\u2029]/u.test(text))return null;
 const normalized=text.normalize('NFKC').replace(/\s/gu,'');
 return /^\p{Script=Han}{3,40}$/u.test(normalized)?digest(normalized):null;
}
export function screenWholeBodyConjunction({views,pages,index}={}){
 try{
  if(!validPositionedBodyViews(views))return result('invalid-positioned-views');
  if(!Array.isArray(index)||!index.length||index.some(p=>!hash(p.pdfSha256)
    ||!Number.isSafeInteger(p.pageNumber)||p.pageNumber<1||!Number.isSafeInteger(p.number)||p.number<1)
    ||new Set(index.map(id)).size!==index.length||new Set(index.map(p=>p.number)).size!==index.length
    ||!Array.isArray(pages)||pages.length!==index.length||new Set(pages.map(id)).size!==pages.length
    ||pages.some(p=>!index.some(q=>id(q)===id(p))))return result('incomplete-or-ambiguous-corpus');
  const assess=createBodyClaimAssessor(pages),ordered=visualBodyViewNames.map(n=>views.find(v=>v.view===n)),candidates=[];
  for(const page of pages){
   const assessment=assess(views,page);
   if(assessment.status!=='observed-body-consistent'||assessment.fieldEvidence.state!=='single-page-field-candidate')continue;
   const support=[];
   for(const offset of [0,2]){
    const pair=assessment.fieldEvidence.readings.slice(offset,offset+2).map(r=>r.ranked.find(p=>id(p)===id(page)));
    const common=pair[0].corroboratedWholeFieldHashes.filter(h=>pair[1].corroboratedWholeFieldHashes.includes(h)),stable=[];
    for(const hash of common){
     const found=ordered.slice(offset,offset+2).map(v=>v.positioned.fields.filter(f=>wholeFieldHash(f.text)===hash));
     if(found.some(f=>f.length!==1)||found[0][0].regionIndex!==found[1][0].regionIndex)continue;
     stable.push({hash,observations:found.flat()});
    }
    if(stable.length<3||stable.some((a,i)=>stable.slice(i+1).some(b=>a.observations.some((o,j)=>overlap(o.crop,b.observations[j].crop)))))continue;
    support.push({views:ordered.slice(offset,offset+2).map(v=>v.view),fieldHashes:stable.map(s=>s.hash),
     distinctFields:stable.length,disjointPhotoCrops:true,extractedAndPairedVisiblePdf:true});
   }
   if(support.length)candidates.push({target:structuredClone(index.find(p=>id(p)===id(page))),support,
    corpusSha256:digest(JSON.stringify(pages)),viewsSha256:digest(JSON.stringify(views)),indexSha256:digest(JSON.stringify(index))});
  }
  return candidates.length===1?result('single-page-conjunction',candidates[0]):result(candidates.length?'ambiguous-conjunction':'no-conjunction');
 }catch{return result('invalid-body-evidence');}
}
