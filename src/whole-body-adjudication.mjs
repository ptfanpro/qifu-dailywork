// Separate unreadable-code route. No code conflict, old claim or serialized
// method label may be cleared by body similarity. Three specific whole fields
// must agree with extraction AND paired visible text in the complete corpus.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {validDetectedCodeReview} from './detected-code-reader.mjs';
import {screenWholeBodyConjunction} from './whole-body-conjunction.mjs';
import {parseCompletePrintedCodes} from './printed-code-parser.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sha=v=>hash(JSON.stringify(v));
const isHash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const empty=a=>Array.isArray(a)&&a.length===0;
const authorizations=new WeakMap();
const require=createRequire(import.meta.url);
export const wholeBodyMethod='blank-code-current-pdf-whole-fields';
const seal=item=>sha({sourceSha256:item.sourceSha256,number:item.number,read:item.detectedCodeRead,
 portable:item.portableCodeRead,windows:item.windowsCodeObservations,candidates:item.candidates,
 observed:item.observedOcrNumber,codeAudit:item.codeAuditHistory,alternate:item.alternateCodeReview,prefix:item.prefixCodeReview,
 codeBody:item.codeBodyAdjudication,proof:item.wholeBodyAdjudication,
 evidence:{method:item.evidence?.method,number:item.evidence?.number,page:item.evidence?.page,
  photoSha256:item.evidence?.photoSha256,pdfSetDigest:item.evidence?.pdfSetDigest}});

function completeBlankRead(read,sourceSha256){
 if(!read||!isHash(sourceSha256)||read.inputSha256!==sourceSha256||!validDetectedCodeReview(read)
   ||read.nativeScaleReview||read.engines!==2||read.errors!==0||read.errorCode
   ||read.incompleteTailObserved!==false||!/^\d{3,4}$/.test(read.expectedPrefix||'')
   ||!empty(read.observations)||!empty(read.independent))return false;
 const c=read.coverage,d=read.sourceDimensions;
 if(c?.kind!=='detected-horizontal-regions'||c.completed!==true||!Number.isSafeInteger(read.regions)
   ||read.regions<1||read.regions>=1000||!Number.isSafeInteger(c.eligibleRegions)||c.eligibleRegions<1
   ||c.eligibleRegions>read.regions||c.processedRegions!==c.eligibleRegions
   ||!Number.isSafeInteger(d?.width)||d.width<1||!Number.isSafeInteger(d?.height)||d.height<1
   ||!Array.isArray(read.readings)||read.readings.length!==c.eligibleRegions*4)return false;
 const keys=new Set(),indexes=new Set();
 for(const r of read.readings){
  const crop=r?.crop,key=`${r?.index}:${r?.engine}:${r?.padding}`;
  if(!r||!['paddle','tesseract'].includes(r.engine)||![.45,.75].includes(r.padding)
   ||!Number.isSafeInteger(r.index)||r.index<0||r.index>=read.regions||keys.has(key)
   ||r.errorCode!==null||r.incompleteTailObserved!==false||r.codeCount!==0||r.fullCode||r.number||r.prefix
   ||!Number.isFinite(r.confidence)||r.confidence<0||r.confidence>(r.engine==='paddle'?1:100)
   ||!crop||['left','top','width','height'].some(k=>!Number.isSafeInteger(crop[k]))
   ||crop.left<0||crop.top<0||crop.width<1||crop.height<1
   ||crop.left+crop.width>d.width||crop.top+crop.height>d.height)return false;
  keys.add(key);indexes.add(r.index);
 }
 if(indexes.size!==c.eligibleRegions)return false;
 for(const i of indexes)for(const p of [.45,.75]){
  const rows=['paddle','tesseract'].map(e=>read.readings.find(r=>r.index===i&&r.padding===p&&r.engine===e));
  if(rows.some(r=>!r)||['left','top','width','height'].some(k=>rows[0].crop[k]!==rows[1].crop[k]))return false;
 }
 return true;
}

export function wholeBodyCandidateBlockReason(item){
 if(!item||item.reliable!==false||item.number!==null||item.evidence!=null
  ||item.observedOcrNumber!=null||!empty(item.candidates)||!empty(item.windowsCodeObservations))return 'existing-number-or-claim';
 // Even an empty/malformed prior audit is not absence of an audit. Never
 // re-enter a failed review by deleting the proposal while keeping its history.
 if(['codeAuditHistory','pdfRecheck','pdfReviewHistory','pdfClaimReviewHistory','bodyReviewHistory',
   'alternateCodeReview','prefixCodeReview','codeBodyAdjudication','wholeBodyAdjudication']
   .some(k=>item[k]!==undefined))return 'prior-review-present';
 if(!completeBlankRead(item.detectedCodeRead,item.sourceSha256))return 'blank-code-scan-incomplete-or-conflicting';
 const p=item.portableCodeRead,c=p?.coverage;
 if(!p||p.schemaVersion!==1||p.status!=='no-complete-code'||!empty(p.observations)
  ||p.expectedPrefix!==item.detectedCodeRead.expectedPrefix||!isHash(p.modelSha256)
  ||p.error||p.blockReason||p.conflictReview||p.incompleteTailObserved!==false
  ||typeof p.partialCodeObserved!=='boolean'||!Number.isSafeInteger(p.readCount)||p.readCount<1
  ||p.emptyReadCount!==p.readCount||c?.kind!=='fixed-narrow-grid'||c.completed!==true
  ||c.skippedLayouts!==0||c.plannedLayouts!==p.readCount||c.completedLayouts!==p.readCount)return 'portable-code-scan-incomplete-or-conflicting';
 // A partial glyph hint is retained, not claimed to be an observed full code.
 return null;
}

export function wholeBodyResolution(item){
 const saved=authorizations.get(item);
 return saved&&item?.reliable===true&&item.evidence?.method===wholeBodyMethod&&saved.seal===seal(item)
  ?structuredClone(saved.proof):null;
}

function currentIndex(pdfPages){
 const hashes=new Map();
 return pdfPages.map(p=>{
  const file=path.resolve(p.pdf||p.file);
  if(!hashes.has(file))hashes.set(file,hash(fs.readFileSync(file)));
  return {pdfSha256:hashes.get(file),pageNumber:p.pageNumber,number:p.number};
 });
}

export async function retainWholeBodyResolution(item,{pages,views,index,pdfPages,pdfSetDigest,photoSource}){
 const reason=wholeBodyCandidateBlockReason(item);
 if(reason)return {status:'unresolved',reason};
 if(!Buffer.isBuffer(photoSource)||hash(photoSource)!==item.sourceSha256||!isHash(pdfSetDigest)
  ||views?.some(v=>v.positioned?.dimensions?.width!==item.detectedCodeRead.sourceDimensions.width
   ||v.positioned?.dimensions?.height!==item.detectedCodeRead.sourceDimensions.height))return {status:'unresolved',reason:'body-source-not-bound'};
 try{
  const metadata=await require('sharp')(photoSource).metadata();
  const dimensions=item.detectedCodeRead.sourceDimensions,swap=metadata.orientation>=5&&metadata.orientation<=8;
  if(dimensions.width!==(swap?metadata.height:metadata.width)||dimensions.height!==(swap?metadata.width:metadata.height))
    return {status:'unresolved',reason:'source-dimensions-changed'};
  if(hash(fs.readFileSync(item.file))!==item.sourceSha256||sha(currentIndex(pdfPages))!==sha(index))
    return {status:'unresolved',reason:'photo-or-pdf-source-changed'};
 }catch{return {status:'unresolved',reason:'photo-or-pdf-source-unavailable'};}
 // Recheck mutable audit records after the asynchronous metadata read too.
 if(wholeBodyCandidateBlockReason(item))return {status:'unresolved',reason:'candidate-changed-during-review'};
 const screen=screenWholeBodyConjunction({pages,views,index});
 if(screen.status!=='single-page-conjunction')return {status:'unresolved',reason:screen.status};
 const bodyCodeReadings=views.flatMap(v=>v.positioned.fields.map(f=>({view:v.view,regionIndex:f.regionIndex,
   ...parseCompletePrintedCodes(f.text,item.detectedCodeRead.expectedPrefix)})));
 const bodyCodeConflict=bodyCodeReadings.some(r=>r.incompleteTailObserved||r.codes.some(c=>
   c.prefix!==item.detectedCodeRead.expectedPrefix||c.number!==screen.candidate.target.number));
 if(bodyCodeConflict){
  // The body reader can discover a code the two earlier readers missed.
  // Retain this new contrary observation as an audit, not just a local return
  // reason that a later gap/scene resolver could forget. No customer text.
  item.codeAuditHistory=[{status:'unresolved',reason:'body-observed-code-conflict',number:null,
    photoSha256:item.sourceSha256,observations:bodyCodeReadings.flatMap(r=>r.codes.map(c=>({...c,view:r.view,regionIndex:r.regionIndex}))),
    incompleteTailObserved:bodyCodeReadings.some(r=>r.incompleteTailObserved)}];
  return {status:'unresolved',reason:'body-observed-code-conflict'};
 }
 const proof={schemaVersion:1,status:'resolved',method:wholeBodyMethod,number:screen.candidate.target.number,
  ...screen.candidate,photoSha256:item.sourceSha256,pdfSetDigest,rawCodeSha256:sha(item.detectedCodeRead),
  portableCodeSha256:sha(item.portableCodeRead),bodyCodeReadings, bindingVerified:false,mayClearCodeConflict:false};
 item.number=proof.number;item.reliable=true;item.wholeBodyAdjudication=structuredClone(proof);
 item.evidence={method:wholeBodyMethod,number:proof.number,page:structuredClone(proof.target),
  photoSha256:proof.photoSha256,pdfSetDigest,bindingVerified:false};
 authorizations.set(item,{seal:seal(item),proof:structuredClone(proof)});
 return proof;
}

export function wholeBodySourceBlockReason(item,pdfPages){
 const proof=wholeBodyResolution(item);
 if(!proof)return 'whole-body-resolution-not-current';
 try{
  if(hash(fs.readFileSync(item.file))!==proof.photoSha256)return 'whole-body-photo-source-changed';
  const index=currentIndex(pdfPages);
  return sha(index)===proof.indexSha256?null:'whole-body-pdf-source-or-index-changed';
 }catch{return 'whole-body-source-unavailable';}
}
