// A positive join of an observed full code and current, physical PDF content.
// Not a body-ranking resolver: no missing slots, filenames or assigned peers.
// Raw contradictory observations are never deleted. A credible opposite code
// remains a veto even when the page content appears to support one candidate.
import crypto from 'node:crypto';
import {validDetectedCodeReview} from './detected-code-reader.mjs';
import {createBodyClaimAssessor} from './body-content-review.mjs';
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id=p=>`${p.pdfSha256}:${p.pageNumber}`;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sameCrop=(a,b)=>a&&b&&['left','top','width','height'].every(k=>a[k]===b[k]);
const unresolved=reason=>({schemaVersion:1,status:'unresolved',reason,number:null,bindingVerified:false});
const credible=o=>o.confidence>=(o.engine==='paddle'?.65:30);
const authorizations=new WeakMap();
export const codeBodyMethod='code-and-current-pdf-body-adjudication';
const itemSeal=item=>sha({read:item.detectedCodeRead,history:item.codeAuditHistory,
  sourceSha256:item.sourceSha256,number:item.number,proof:item.codeBodyAdjudication});

// A serialized label cannot waive an old audit. A fresh plan must recompute
// the join, then gets a process-local authorization tied to immutable raw reads.
export function codeBodyResolution(item) {
  const saved=authorizations.get(item);
  return saved&&item?.evidence?.method===codeBodyMethod&&saved.seal===itemSeal(item)?saved.proof:null;
}

export function codeBodyCandidateForItem(item,index) {
  if(item?.reliable||item?.pdfRecheck||item?.pdfReviewHistory||item?.bodyReviewHistory||item?.portableCodeRead)
    return unresolved('prior-or-independent-review-present');
  const read=item?.detectedCodeRead,history=item?.codeAuditHistory;
  if(!read||!Array.isArray(history)||history.length!==1)return unresolved('unsupported-code-audit-history');
  const audit=history[0];
  if(audit.status!=='unresolved'||audit.number!==null
    ||!['detected-code-unconfirmed','detected-code-number-conflict','detected-code-prefix-conflict'].includes(audit.reason))
    return unresolved('unsupported-code-audit-history');
  const raw=[read,...(read.nativeScaleReview?[read.nativeScaleReview.read]:[])]
    .flatMap(r=>[...(r?.observations||[]),...(r?.independent||[])]);
  const normalize=(o,crop)=>({fullCode:o.fullCode,prefix:o.prefix,number:o.number,engine:o.engine,
    confidence:o.confidence,index:o.index,padding:o.padding,crop});
  if(!Array.isArray(audit.observations)||sha(audit.observations.map(o=>normalize(o,o.cropBounds)))
    !==sha(raw.map(o=>normalize(o,o.crop))))return unresolved('audit-observations-changed');
  const candidate=codeBodyCandidate({read,expectedPrefix:read.expectedPrefix,photoSha256:item.sourceSha256,index});
  if(Number.isInteger(item.observedOcrNumber)&&item.observedOcrNumber!==candidate.number)return unresolved('prior-visible-code-conflict');
  return candidate;
}

export function retainCodeBodyResolution(item,{pages,views,index,pdfSetDigest}) {
  const candidate=codeBodyCandidateForItem(item,index);
  if(candidate.status!=='candidate'||!hash(pdfSetDigest))return candidate;
  const result=adjudicateCodeBody({read:item.detectedCodeRead,expectedPrefix:item.detectedCodeRead.expectedPrefix,
    photoSha256:item.sourceSha256,pages,views,index});
  if(result.status!=='resolved')return result;
  const proof={...result,pdfSetDigest};
  // Preserve the raw unresolved audit as evidence of WHY adjudication ran.
  item.number=result.number;item.reliable=true;item.codeBodyAdjudication=proof;
  item.evidence={method:codeBodyMethod,number:result.number,fullCode:result.fullCode,
    pdfSetDigest,photoSha256:result.photoSha256,page:result.target,bindingVerified:false};
  authorizations.set(item,{seal:itemSeal(item),proof});
  return result;
}

function validateRead(read,photoSha256) {
  if(!read||!hash(photoSha256)||read.inputSha256!==photoSha256||!validDetectedCodeReview(read))return false;
  // Validate and retain a bounded scale review too; never drop its contrary
  // strings or interpret a failed additional scan as a blank observation.
  if(read.nativeScaleReview&&!validateRead(read.nativeScaleReview.read,photoSha256))return false;
  const c=read.coverage,d=read.sourceDimensions;
  if(read.engines!==2||read.errors!==0||read.errorCode||read.incompleteTailObserved!==false
    ||c?.kind!=='detected-horizontal-regions'||c.completed!==true
    ||!Number.isInteger(read.regions)||read.regions<1||read.regions>=1000
    ||!Number.isInteger(c.eligibleRegions)||c.eligibleRegions<1||c.eligibleRegions>read.regions
    ||c.processedRegions!==c.eligibleRegions||!d||!Number.isInteger(d.width)||d.width<1
    ||!Number.isInteger(d.height)||d.height<1||!Array.isArray(read.readings)
    ||read.readings.length!==c.eligibleRegions*4||!Array.isArray(read.observations)
    ||!Array.isArray(read.independent))return false;
  const validCrop=crop=>crop&&['left','top','width','height'].every(k=>Number.isInteger(crop[k]))
    &&crop.left>=0&&crop.top>=0&&crop.width>0&&crop.height>0
    &&crop.left+crop.width<=d.width&&crop.top+crop.height<=d.height;
  const validRow=o=>o&&['paddle','tesseract'].includes(o.engine)&&[.45,.75].includes(o.padding)
    &&Number.isInteger(o.index)&&o.index>=0&&o.index<read.regions&&validCrop(o.crop)
    &&Number.isFinite(o.confidence)&&o.confidence>=0&&o.confidence<=(o.engine==='paddle'?1:100);
  const key=o=>`${o.index}:${o.engine}:${o.padding}`,keys=new Set();
  for(const r of read.readings){
    if(!validRow(r)||r.errorCode!==null||r.incompleteTailObserved!==false
      ||!Number.isInteger(r.codeCount)||r.codeCount<0||keys.has(key(r)))return false;
    keys.add(key(r));
  }
  const indexes=new Set(read.readings.map(r=>r.index));
  if(indexes.size!==c.eligibleRegions)return false;
  for(const i of indexes)for(const e of ['paddle','tesseract'])for(const p of [.45,.75])if(!keys.has(`${i}:${e}:${p}`))return false;
  const all=[...read.observations,...read.independent];
  for(const o of all){
    const match=/^(\d{3,4})-1-([1-9]\d{0,3})$/.exec(o.fullCode||'');
    if(!validRow(o)||!match||o.prefix!==match[1]||o.number!==Number(match[2]))return false;
    const primary=read.readings.find(r=>key(r)===key(o));
    if(!primary||!sameCrop(primary.crop,o.crop))return false;
    if(o.preprocessing===undefined&&primary.confidence!==o.confidence)return false;
  }
  if(read.observations.some(o=>o.engine!=='paddle'||o.preprocessing!==undefined)
    ||read.independent.some(o=>o.engine!=='tesseract'))return false;
  return read.readings.every(r=>all.filter(o=>o.preprocessing===undefined&&key(o)===key(r)).length===r.codeCount);
}

export function codeBodyCandidate({read,expectedPrefix,photoSha256,index}) {
  if(!validateRead(read,photoSha256))return unresolved('code-read-incomplete-or-invalid');
  if(!/^\d{3,4}$/.test(expectedPrefix)||!Array.isArray(index)||!index.length
    ||index.some(p=>!hash(p.pdfSha256)||!Number.isInteger(p.pageNumber)||p.pageNumber<1
      ||!Number.isInteger(p.number)||p.number<1)
    ||new Set(index.map(id)).size!==index.length||new Set(index.map(p=>p.number)).size!==index.length)
    return unresolved('pdf-index-incomplete-or-duplicate');
  const reads=[read,...(read.nativeScaleReview?[read.nativeScaleReview.read]:[])];
  const all=reads.flatMap(r=>[...r.observations,...r.independent]),strong=all.filter(credible);
  if(new Set(strong.map(o=>o.fullCode)).size!==1)return unresolved('credible-code-conflict-or-absence');
  const code=strong[0];
  if(code.prefix!==expectedPrefix)return unresolved('credible-prefix-conflict');
  // V17's 0.85 high-confidence digit floor, applied to TWO original crops
  // from the SAME detector region. These are not called independent engines.
  const good=read.observations.filter(o=>o.fullCode===code.fullCode&&o.confidence>=.85);
  if(!good.some(o=>good.some(p=>o.index===p.index&&o.padding!==p.padding&&!sameCrop(o.crop,p.crop))))
    return unresolved('insufficient-high-confidence-code-views');
  const targets=index.filter(p=>p.number===code.number);
  if(targets.length!==1)return unresolved('observed-code-outside-pdf');
  return {schemaVersion:1,status:'candidate',number:code.number,fullCode:code.fullCode,
    target:structuredClone(targets[0]),photoSha256,codeReadSha256:sha(read),indexSha256:sha(index),
    weakAlternatives:all.filter(o=>o.fullCode!==code.fullCode).length,bindingVerified:false};
}

export function adjudicateCodeBody(input) {
  const candidate=codeBodyCandidate(input);
  if(candidate.status!=='candidate')return candidate;
  try {
    const {pages,views,index}=input;
    if(!Array.isArray(pages)||pages.length!==index.length||new Set(pages.map(id)).size!==pages.length
      ||pages.some(p=>!index.some(q=>id(p)===id(q))))return unresolved('body-corpus-incomplete');
    const assessment=createBodyClaimAssessor(pages)(views,candidate.target);
    if(assessment.status!=='observed-body-consistent')return unresolved(`body-${assessment.status}`);
    const fields=assessment.fieldEvidence;
    if(fields.state!=='single-page-field-candidate')return unresolved('body-not-page-specific');
    const support=[];
    for(const offset of [0,2]){
      const pair=fields.readings.slice(offset,offset+2).map(r=>r.ranked.find(p=>id(p)===id(candidate.target)));
      const common=pair[0].longSpecificFieldHashes.filter(h=>pair[1].longSpecificFieldHashes.includes(h));
      // At least two DISTINCT whole fields, each >=4 Han characters, unique
      // in the complete current corpus and observed in both same-layout views.
      // Shared names, template phrases and one-view snippets cannot qualify.
      if(common.length>=2)support.push({views:fields.readings.slice(offset,offset+2).map(r=>r.view),fieldHashes:common});
    }
    if(!support.length)return unresolved('insufficient-paired-whole-field-evidence');
    return {...candidate,status:'resolved',policy:'observed-code-plus-paired-current-body-v1',
      bodyCorpusSha256:sha(pages),bodyViewsSha256:sha(views),support,assessment,
      // Page correspondence only, NOT a statement that online order sets or
      // upload counts have been verified. Those gates remain separate.
      pageCorrespondenceVerified:true,bindingVerified:false};
  } catch {return unresolved('body-evidence-incomplete-or-invalid');}
}
