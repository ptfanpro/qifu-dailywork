// Only the prefix may disagree. A stable tail is observed, never filled from
// missing PDF slots. Model agreement is not independent-engine majority voting.
const sameCrop=(a,b)=>a&&b&&['left','top','width','height'].every(k=>a[k]===b[k]);
const credible=o=>o.confidence>=(o.engine==='paddle'?.65:30);
const oneSubstitution=(a,b)=>a.length===b.length&&[...a].filter((c,i)=>c!==b[i]).length===1;
export function prefixReviewSeed(read,rows) {
 if(!read||read.nativeScaleReview||read.engines!==2||read.errors!==0||read.incompleteTailObserved!==false
   ||!Array.isArray(rows)||rows.length!==2||rows.some(r=>r.incompleteTailObserved||r.codes?.length!==1||r.confidence<.65))return null;
 const code=rows[0].codes[0],region=rows[0].index;
 if(code.prefix!==read.expectedPrefix||rows.some(r=>r.codes[0].fullCode!==code.fullCode||r.index!==region)
   ||!rows.some(r=>r.confidence>=.85)||new Set(rows.map(r=>r.padding)).size!==2
   ||sameCrop(rows[0].crop,rows[1].crop))return null;
 const all=[...read.observations,...read.independent],strong=all.filter(credible);
 if(!strong.length||strong.some(o=>o.index!==region||o.number!==code.number
   ||(o.prefix!==code.prefix&&!oneSubstitution(o.prefix,code.prefix))))return null;
 const original=read.observations.filter(o=>o.index===region&&o.confidence>=.85);
 if(original.length!==2||new Set(original.map(o=>o.padding)).size!==2||sameCrop(original[0].crop,original[1].crop)
   ||new Set(original.map(o=>o.fullCode)).size!==1||original[0].prefix===code.prefix)return null;
 const opposite=original[0].fullCode;
 if(new Set(strong.filter(o=>o.engine==='tesseract'&&o.fullCode===opposite).map(o=>o.padding)).size===2)return null;
 return {...code,index:region};
}
export function prefixReviewSupport(read,priorRows,rows) {
 const seed=prefixReviewSeed(read,priorRows);
 if(!seed||!Array.isArray(rows)||rows.length!==2)return null;
 for(const r of rows){
  const prior=priorRows.find(p=>p.index===r.index&&p.padding===r.padding);
  if(!prior||!sameCrop(prior.crop,r.crop)||prior.cropSha256!==r.cropSha256||r.confidence<.85
   ||r.incompleteTailObserved||r.codes?.length!==1||r.codes[0].fullCode!==seed.fullCode)return null;
 }
 if(new Set(rows.map(r=>r.padding)).size!==2)return null;
 return {...seed,codeSupport:structuredClone(rows),codePolicy:'stable-original-tail-plus-two-prefix-models-v1'};
}
