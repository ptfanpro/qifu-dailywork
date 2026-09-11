// A positive join of an observed full code and current, physical PDF content.
// Not a body-ranking resolver: no missing slots, filenames or assigned peers.
// Raw contradictory observations are never deleted. Same-region MODEL
// disagreement needs a fresh alternate observation plus actual page content;
// a PDF/body score alone cannot clear it. Independent opposite consensus vetoes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {validDetectedCodeReview} from './detected-code-reader.mjs';
import {createBodyClaimAssessor} from './body-content-review.mjs';
import {positionedBodySupport} from './positioned-body-evidence.mjs';
import {codeModelReviewEvidence,prefixCodeReviewEvidence} from './code-model-review.mjs';
import {validPositionedBodyViews} from './body-positioned-observation.mjs';
import {visualBodyViewNames} from './pdf-visual-body-evidence.mjs';
import {printedDatePrefixSeed,printedDateSupport} from './printed-date-prefix-evidence.mjs';
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id=p=>`${p.pdfSha256}:${p.pageNumber}`;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sameCrop=(a,b)=>a&&b&&['left','top','width','height'].every(k=>a[k]===b[k]);
const unresolved=reason=>({schemaVersion:1,status:'unresolved',reason,number:null,bindingVerified:false});
const credible=o=>o.confidence>=(o.engine==='paddle'?.65:30);
const authorizations=new WeakMap();
export const codeBodyMethod='code-and-current-pdf-body-adjudication';
const itemSeal=item=>sha({read:item.detectedCodeRead,history:item.codeAuditHistory,
  sourceSha256:item.sourceSha256,number:item.number,proof:item.codeBodyAdjudication,alternate:item.alternateCodeReview,prefix:item.prefixCodeReview});

// A serialized label cannot waive an old audit. A fresh plan must recompute
// the join, then gets a process-local authorization tied to immutable raw reads.
export function codeBodyResolution(item) {
  const saved=authorizations.get(item);
  return saved&&item?.evidence?.method===codeBodyMethod&&saved.seal===itemSeal(item)?saved.proof:null;
}

// Recheck the entire physical corpus and its number-to-page mapping, not just
// a page ordinal (page 1 can occur in every PDF). Caller metadata is not a
// substitute for reading the current source bytes. A renamed byte-identical
// PDF is acceptable here; the separate business-date/plan gates still apply.
export function codeBodySourceBlockReason(item,pdfPages) {
  const proof=codeBodyResolution(item);
  if(!proof)return 'code-body-resolution-not-current';
  try {
    const fileHash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if(fileHash(item.file)!==proof.photoSha256)return 'code-body-photo-source-changed';
    const hashes=new Map();
    const index=pdfPages.map(p=>{
      const file=path.resolve(p.pdf||p.file);
      if(!hashes.has(file))hashes.set(file,fileHash(file));
      return {pdfSha256:hashes.get(file),pageNumber:p.pageNumber,number:p.number};
    });
    if(sha(index)!==proof.indexSha256)return 'code-body-pdf-source-or-index-changed';
    return null;
  } catch {return 'code-body-source-unavailable';}
}

function freshItemBlock(item) {
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
  return null;
}

export function codeBodyModelReviewEligible(item,index){
  if(freshItemBlock(item)||!validateRead(item.detectedCodeRead,item.sourceSha256)||item.detectedCodeRead.nativeScaleReview
    ||Number.isInteger(item.observedOcrNumber))return false;
  const read=item.detectedCodeRead,rows=[...read.observations,...read.independent];
  return codeBodyCandidateForItem(item,index).status!=='candidate'&&rows.some(credible)
    &&new Set(rows.map(o=>o.index)).size<=4;
}

export function codeBodyCandidateForItem(item,index) {
  const block=freshItemBlock(item);if(block)return block;
  const read=item.detectedCodeRead;
  const candidate=codeBodyCandidate({read,expectedPrefix:read.expectedPrefix,photoSha256:item.sourceSha256,index,alternateCodeReview:item.alternateCodeReview,prefixCodeReview:item.prefixCodeReview});
  if(Number.isInteger(item.observedOcrNumber)&&item.observedOcrNumber!==candidate.number)return unresolved('prior-visible-code-conflict');
  return candidate;
}

export function retainCodeBodyResolution(item,{pages,views,index,pdfSetDigest,positionedLayoutReview}) {
  const candidate=codeBodyCandidateForItem(item,index);
  if(candidate.status!=='candidate'||!hash(pdfSetDigest))return candidate;
  const result=adjudicateCodeBody({read:item.detectedCodeRead,expectedPrefix:item.detectedCodeRead.expectedPrefix,
    photoSha256:item.sourceSha256,pages,views,index,positionedLayoutReview,alternateCodeReview:item.alternateCodeReview,prefixCodeReview:item.prefixCodeReview});
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

function oneEdit(a,b){
  if(a===b)return true;if(Math.abs(a.length-b.length)>1)return false;
  let i=0,j=0,edits=0;
  while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;
    if(a.length>=b.length)i++;if(b.length>=a.length)j++;}
  return edits+(a.length-i)+(b.length-j)<=1;
}

function alternateCandidate(read,photoSha256,expectedPrefix,all,report){
  const rows=codeModelReviewEvidence(report,read,photoSha256);
  if(!rows||rows.some(r=>r.incompleteTailObserved))return null;
  const observations=rows.flatMap(r=>r.codes.map(c=>({...c,confidence:r.confidence,index:r.index,padding:r.padding,crop:r.crop})));
  const credibleNew=observations.filter(o=>o.confidence>=.65);
  if(new Set(credibleNew.map(o=>o.fullCode)).size!==1)return null;
  const code=credibleNew[0];if(!code||code.prefix!==expectedPrefix)return null;
  const support=observations.filter(o=>o.fullCode===code.fullCode&&o.confidence>=.85);
  const sameRegion=support.filter(o=>o.index===code.index);
  if(!sameRegion.some(a=>sameRegion.some(b=>a.padding!==b.padding&&!sameCrop(a.crop,b.crop))))return null;
  const strong=all.filter(credible);
  if(!strong.some(o=>o.index===code.index&&o.fullCode===code.fullCode&&o.confidence>=(o.engine==='paddle'?.85:30)))return null;
  if(strong.some(o=>o.index!==code.index||!oneEdit(o.fullCode,code.fullCode)))return null;
  // Repeated agreement of BOTH original engines on an opposite complete word
  // remains a veto. Two paddings or two models from one family are not votes
  // that can outnumber an independently established opposite-code consensus.
  for(const opposite of new Set(strong.filter(o=>o.fullCode!==code.fullCode).map(o=>o.fullCode))){
    if(['paddle','tesseract'].every(engine=>new Set(strong.filter(o=>o.engine===engine&&o.fullCode===opposite).map(o=>o.padding)).size===2))return null;
  }
  return {...code,modelReviewSha256:sha(report),codeSupport:structuredClone(sameRegion)};
}

export function codeBodyCandidate({read,expectedPrefix,photoSha256,index,alternateCodeReview,prefixCodeReview}) {
  if(!validateRead(read,photoSha256))return unresolved('code-read-incomplete-or-invalid');
  if(!/^\d{3,4}$/.test(expectedPrefix)||!Array.isArray(index)||!index.length
    ||index.some(p=>!hash(p.pdfSha256)||!Number.isInteger(p.pageNumber)||p.pageNumber<1
      ||!Number.isInteger(p.number)||p.number<1)
    ||new Set(index.map(id)).size!==index.length||new Set(index.map(p=>p.number)).size!==index.length)
    return unresolved('pdf-index-incomplete-or-duplicate');
  const reads=[read,...(read.nativeScaleReview?[read.nativeScaleReview.read]:[])];
  const all=reads.flatMap(r=>[...r.observations,...r.independent]),strong=all.filter(credible);
  const prefix=prefixCodeReviewEvidence(prefixCodeReview,alternateCodeReview,read,photoSha256);
  const dateSeed=printedDatePrefixSeed(read,codeModelReviewEvidence(alternateCodeReview,read,photoSha256),expectedPrefix);
  const alternate=alternateCandidate(read,photoSha256,expectedPrefix,all,alternateCodeReview)||prefix
    ||(dateSeed?{...dateSeed,modelReviewSha256:sha(alternateCodeReview)}:null);
  if(!alternate&&new Set(strong.map(o=>o.fullCode)).size!==1)return unresolved('credible-code-conflict-or-absence');
  const code=alternate||strong[0];
  if(code.prefix!==expectedPrefix)return unresolved('credible-prefix-conflict');
  // V17's 0.85 high-confidence digit floor, applied to TWO original crops
  // from the SAME detector region. These are not called independent engines.
  const good=read.observations.filter(o=>o.fullCode===code.fullCode&&o.confidence>=.85);
  if(!alternate&&!good.some(o=>good.some(p=>o.index===p.index&&o.padding!==p.padding&&!sameCrop(o.crop,p.crop))))
    return unresolved('insufficient-high-confidence-code-views');
  const targets=index.filter(p=>p.number===code.number);
  if(targets.length!==1)return unresolved('observed-code-outside-pdf');
  return {schemaVersion:1,status:'candidate',number:code.number,fullCode:code.fullCode,
    target:structuredClone(targets[0]),photoSha256,codeReadSha256:sha(read),indexSha256:sha(index),
    ...(alternate?{modelReviewSha256:alternate.modelReviewSha256,codeSupport:alternate.codeSupport}:{}),
    ...(alternate?.prefixReviewSha256?{prefixReviewSha256:alternate.prefixReviewSha256,codePolicy:alternate.codePolicy}:{}),
    ...(alternate?.requiresPrintedDate?{requiresPrintedDate:true,fullCodeObserved:false,
      codePolicy:alternate.codePolicy,observedFullCodes:alternate.observedFullCodes}:{}),
    weakAlternatives:all.filter(o=>o.fullCode!==code.fullCode).length,bindingVerified:false};
}

function shortFieldConjunction(views,fields,target){
  if(!validPositionedBodyViews(views))return [];
  const ordered=visualBodyViewNames.map(name=>views.find(v=>v.view===name)),support=[];
  const shortHash=text=>{
    if(/[\r\n\u2028\u2029]/u.test(text))return null;
    const value=text.normalize('NFKC').replace(/\s/gu,'');
    return /^\p{Script=Han}{3}$/u.test(value)?crypto.createHash('sha256').update(value).digest('hex'):null;
  };
  const overlaps=(a,b)=>Math.min(a.left+a.width,b.left+b.width)>Math.max(a.left,b.left)
    &&Math.min(a.top+a.height,b.top+b.height)>Math.max(a.top,b.top);
  for(const offset of [0,2]){
    const pair=fields.readings.slice(offset,offset+2).map(r=>r.ranked.find(p=>id(p)===id(target)));
    const common=pair[0].corroboratedShortFieldHashes.filter(h=>pair[1].corroboratedShortFieldHashes.includes(h));
    const stable=[];
    for(const hash of common){
      const observations=ordered.slice(offset,offset+2).map(v=>v.positioned.fields.filter(f=>shortHash(f.text)===hash));
      if(observations.some(fs=>fs.length!==1)||observations[0][0].regionIndex!==observations[1][0].regionIndex)continue;
      stable.push({hash,observations:observations.flat()});
    }
    // No pooling fragments, repeated detections, or overlapping padded crops.
    // This adds a stricter multi-field route for short names; it does not
    // lower the existing two-long-field or positioned-geometry thresholds.
    if(stable.length<3||stable.some((a,i)=>stable.slice(i+1).some(b=>a.observations.some((f,j)=>overlaps(f.crop,b.observations[j].crop)))))continue;
    support.push({views:ordered.slice(offset,offset+2).map(v=>v.view),fieldHashes:stable.map(f=>f.hash),
      distinctFields:stable.length,independentlyExtractedAndVisible:true,disjointPhotoCrops:true});
  }
  return support;
}

export function adjudicateCodeBody(input) {
  const candidate=codeBodyCandidate(input);
  if(candidate.status!=='candidate')return candidate;
  try {
    const {pages,views,index}=input;
    if(!Array.isArray(pages)||pages.length!==index.length||new Set(pages.map(id)).size!==pages.length
      ||pages.some(p=>!index.some(q=>id(p)===id(q))))return unresolved('body-corpus-incomplete');
    const assessment=createBodyClaimAssessor(pages)(views,candidate.target);
    const dateSupport=candidate.requiresPrintedDate?printedDateSupport(input,candidate.target):null;
    if(candidate.requiresPrintedDate&&!dateSupport)return unresolved('printed-business-date-not-corroborated');
    // A positioned composite can resolve a short/shared-name ambiguity only
    // WITH the original strong full code. Contrary body/code evidence remains
    // a veto; the earlier independent long-field rule remains unchanged.
    if(!candidate.prefixReviewSha256&&!candidate.requiresPrintedDate&&input.positionedLayoutReview&&['observed-body-consistent','no-specific-body-evidence'].includes(assessment.status)){
      const support=positionedBodySupport(input,candidate.target);
      if(support)return {...candidate,status:'resolved',policy:support.policy,
        bodyCorpusSha256:sha(pages),bodyViewsSha256:sha(views),positionedSupport:support,assessment,
        pageCorrespondenceVerified:true,bindingVerified:false};
    }
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
    const shortSupport=support.length||candidate.prefixReviewSha256||candidate.requiresPrintedDate?[]:shortFieldConjunction(views,fields,candidate.target);
    if(!support.length&&!shortSupport.length)return unresolved('insufficient-paired-whole-field-evidence');
    return {...candidate,status:'resolved',policy:support.length?'observed-code-plus-paired-current-body-v1':'observed-code-plus-three-disjoint-short-fields-v1',
      bodyCorpusSha256:sha(pages),bodyViewsSha256:sha(views),support:support.length?support:shortSupport,assessment,
      ...(dateSupport?{printedDateSupport:dateSupport}:{}),
      // Page correspondence only, NOT a statement that online order sets or
      // upload counts have been verified. Those gates remain separate.
      pageCorrespondenceVerified:true,bindingVerified:false};
  } catch {return unresolved('body-evidence-incomplete-or-invalid');}
}
