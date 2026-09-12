import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {input,views} from './experiments/whole-body-conjunction-regression.mjs';
import {reviewCurrentPdfBodies} from '../src/body-content-review.mjs';
import {photoCodeAuditBlockReason,recheckReliablePhotoClaimsWithPdf} from '../src/photo-prepare.mjs';
import {wholeBodyResolution,wholeBodyMethod,wholeBodyCandidateBlockReason} from '../src/whole-body-adjudication.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-body-only-collector-'));
export function blankBodyItem(file,sourceSha256){
 const readings=['paddle','tesseract'].flatMap(engine=>[.45,.75].map(padding=>({engine,padding,index:0,
  crop:{left:10,top:20,width:120,height:30},confidence:0,codeCount:0,errorCode:null,incompleteTailObserved:false})));
 return {file,sourceSha256,reliable:false,number:null,evidence:null,candidates:[],windowsCodeObservations:[],
  detectedCodeRead:{inputSha256:sourceSha256,expectedPrefix:'267',regions:1,engines:2,errors:0,
   observations:[],independent:[],readings,incompleteTailObserved:false,sourceDimensions:{width:1000,height:800},
   coverage:{kind:'detected-horizontal-regions',completed:true,eligibleRegions:1,processedRegions:1}},
  portableCodeRead:{schemaVersion:1,status:'no-complete-code',expectedPrefix:'267',modelSha256:'a'.repeat(64),
   observations:[],readCount:874,emptyReadCount:874,partialCodeObserved:true,incompleteTailObserved:false,error:null,
   coverage:{kind:'fixed-narrow-grid',plannedLayouts:874,completedLayouts:874,skippedLayouts:0,completed:true}}};
}
try{
 const pdf=path.join(root,'synthetic.pdf'),file=path.join(root,'synthetic.jpg');
 fs.writeFileSync(pdf,'synthetic two-page PDF identity');
 fs.writeFileSync(file,await createRequire(import.meta.url)('sharp')({create:{width:1000,height:800,channels:3,background:'#d03344'}}).jpeg().toBuffer());
 const photoBytes=fs.readFileSync(file),pdfBytes=fs.readFileSync(pdf),pdfHash=sha(pdfBytes);
 const make=()=>{
  fs.writeFileSync(file,photoBytes);fs.writeFileSync(pdf,pdfBytes);
  const data=input(),item=blankBodyItem(file,sha(photoBytes));data.pages.forEach(p=>p.pdfSha256=pdfHash);
  // Physical PDF identity is complete; grayscale vectors need not be saved
  // in a serialized plan and are not the identity proof on this new route.
  const pdfPages=[1,2].map((pageNumber,i)=>({pdf,pageNumber,number:7+i}));
  const args={appRoot:root,pdfFiles:[pdf],pdfPages,
   pdfIndexBinding:{digest:sha('synthetic set'),files:[{name:path.basename(pdf),sha256:pdfHash}]},
   claims:[],unresolvedClaims:[item],loadPages:async()=>data.pages,
   createReader:async()=>({read:async(_bytes,options)=>{assert.equal(options.includePositions,true);return data.views;},release:async()=>{}})};
  return {data,item,pdfPages,args};
 };
 const {item,pdfPages,args}=make();
 const before=JSON.stringify({read:item.detectedCodeRead,portable:item.portableCodeRead});
 const result=await reviewCurrentPdfBodies(args);
 assert.equal(result.adjudicated?.length||0,1,'complete blank-code photo with three unique whole body fields must enter the collector');
 assert.equal(item.number,7);assert.equal(photoCodeAuditBlockReason(item),null);
 assert.equal(JSON.stringify({read:item.detectedCodeRead,portable:item.portableCodeRead}),before,'raw reads, including partial-code hint, remain unchanged');
 assert.equal((await recheckReliablePhotoClaimsWithPdf([item],pdfPages)).confirmed,1);
 let negatives=0;
 for(const kind of ['prior-code-audit','empty-code-audit','prior-pdf','prior-pdf-history','prior-body-history','prior-evidence',
  'existing-number','windows-code','candidate-number','observed-number','alternate-review','prefix-review',
  'detected-opposite','detected-low-confidence','detected-error','detected-partial','detected-incomplete','missing-reading',
  'changed-reading-crop','hidden-row-code','portable-opposite','portable-error','portable-incomplete','portable-tail',
  'missing-portable','portable-missing-count','portable-model','raw-source-hash',
  'photo-before','pdf-during','photo-during','pdf-on-release','photo-on-release','prior-added-during',
  'partial-pages','duplicate-body','wrong-body-dimensions','wrong-source-dimensions','missing-positions',
  'body-opposite-code','body-foreign-prefix','body-code-tail']){
  const t=make();assert.equal(wholeBodyCandidateBlockReason(t.item),null,`${kind}: fresh positive eligibility`);
  if(kind==='prior-code-audit')t.item.codeAuditHistory=[{status:'unresolved',reason:'conflict'}];
  if(kind==='empty-code-audit')t.item.codeAuditHistory=[];
  if(kind==='prior-pdf')t.item.pdfRecheck={status:'rejected',reason:'old conflict'};
  if(kind==='prior-pdf-history')t.item.pdfClaimReviewHistory=[{status:'rejected'}];
  if(kind==='prior-body-history')t.item.bodyReviewHistory=[{status:'conflicting-body'}];
  if(kind==='prior-evidence')t.item.evidence={method:'old-claim'};
  if(kind==='existing-number')t.item.number=8;
  if(kind==='windows-code')t.item.windowsCodeObservations=[{number:8}];
  if(kind==='candidate-number')t.item.candidates=[{number:8}];
  if(kind==='observed-number')t.item.observedOcrNumber=8;
  if(kind==='alternate-review')t.item.alternateCodeReview={};
  if(kind==='prefix-review')t.item.prefixCodeReview={};
  if(['detected-opposite','detected-low-confidence'].includes(kind))t.item.detectedCodeRead.observations=[{fullCode:'267-1-8',number:8,confidence:kind==='detected-opposite'?.99:.01}];
  if(kind==='detected-error')t.item.detectedCodeRead.errors=1;
  if(kind==='detected-partial')t.item.detectedCodeRead.incompleteTailObserved=true;
  if(kind==='detected-incomplete')t.item.detectedCodeRead.coverage.completed=false;
  if(kind==='missing-reading')t.item.detectedCodeRead.readings.pop();
  if(kind==='changed-reading-crop')t.item.detectedCodeRead.readings[0].crop.left++;
  if(kind==='hidden-row-code')t.item.detectedCodeRead.readings[0].fullCode='267-1-8';
  if(kind==='portable-opposite')t.item.portableCodeRead.observations=[{fullCode:'267-1-8',number:8}];
  if(kind==='portable-error')t.item.portableCodeRead.error='unavailable';
  if(kind==='portable-incomplete')t.item.portableCodeRead.coverage.completed=false;
  if(kind==='portable-tail')t.item.portableCodeRead.incompleteTailObserved=true;
  if(kind==='missing-portable')delete t.item.portableCodeRead;
  if(kind==='portable-missing-count')delete t.item.portableCodeRead.emptyReadCount;
  if(kind==='portable-model')t.item.portableCodeRead.modelSha256='invalid';
  if(kind==='raw-source-hash')t.item.detectedCodeRead.inputSha256='c'.repeat(64);
  if(kind==='photo-before')fs.writeFileSync(file,'replacement before body');
  if(kind==='partial-pages')t.data.pages.pop();
  if(kind==='duplicate-body')t.data.pages[1]={...structuredClone(t.data.pages[0]),pageNumber:2};
  if(kind==='wrong-body-dimensions')t.data.views.forEach(v=>v.positioned.dimensions.width++);
  if(kind==='wrong-source-dimensions')t.item.detectedCodeRead.sourceDimensions.width++;
  if(kind==='missing-positions')t.data.views.forEach(v=>delete v.positioned);
  if(['body-opposite-code','body-foreign-prefix','body-code-tail'].includes(kind))t.data.views=views([
    '松柏青','海月明','竹风远',kind==='body-opposite-code'?'267-1-8':kind==='body-foreign-prefix'?'287-1-7':'267-1-7 9']);
  const reader=await t.args.createReader();
  t.args.createReader=async()=>({read:async(...a)=>{
   if(kind==='pdf-during')fs.writeFileSync(pdf,'replacement while reading');
   if(kind==='photo-during')fs.writeFileSync(file,'replacement while reading');
   if(kind==='prior-added-during')t.item.codeAuditHistory=[{status:'unresolved',reason:'new conflict'}];
   return reader.read(...a);
  },release:async()=>{
   if(kind==='pdf-on-release')fs.writeFileSync(pdf,'replacement on release');
   if(kind==='photo-on-release')fs.writeFileSync(file,'replacement on release');
  }});
  const beforeAudit=JSON.stringify(t.item.detectedCodeRead),r=await reviewCurrentPdfBodies(t.args);
  assert.equal(r.adjudicated?.length||0,0,kind);assert.equal(t.item.reliable,false,kind);
  assert.equal(wholeBodyResolution(t.item),null,kind);
  if(['body-opposite-code','body-foreign-prefix','body-code-tail'].includes(kind)){
   assert.equal(photoCodeAuditBlockReason(t.item),'body-observed-code-conflict',`${kind}: new contrary evidence must survive later stages`);
   assert.equal(t.item.codeAuditHistory[0].photoSha256,t.item.sourceSha256);
   assert.doesNotMatch(JSON.stringify(t.item.codeAuditHistory),/松柏|海月|竹风/);
  }
  assert.equal(JSON.stringify(t.item.detectedCodeRead),beforeAudit,`${kind}: original readings retained`);negatives++;
 }
 {
  const t=make();t.data.views=views(['松柏青','海月明','竹风远','267-1-7']);
  assert.equal((await reviewCurrentPdfBodies(t.args)).adjudicated.length,1,'consistent full code newly seen in body views is retained');
  assert.equal(t.item.wholeBodyAdjudication.bodyCodeReadings.flatMap(r=>r.codes).length,2);
  assert.equal((await recheckReliablePhotoClaimsWithPdf([t.item],t.pdfPages)).confirmed,1);
 }
 for(const kind of ['photo-after','pdf-after','index-number','missing-other-page','raw-code-change','partial-hint-change',
  'proof-change','claimed-number','evidence-number','serialized-item','label-only','new-code-audit']){
  const t=make();assert.equal((await reviewCurrentPdfBodies(t.args)).adjudicated.length,1,`${kind}: fresh positive authorization`);
  if(kind==='photo-after')fs.writeFileSync(file,'replacement after authorization');
  if(kind==='pdf-after')fs.writeFileSync(pdf,'replacement after authorization');
  if(kind==='index-number')t.pdfPages[1].number=9;
  if(kind==='missing-other-page')t.pdfPages.pop();
  if(kind==='raw-code-change')t.item.detectedCodeRead.readings[0].confidence=.8;
  if(kind==='partial-hint-change')t.item.portableCodeRead.partialCodeObserved=false;
  if(kind==='proof-change')t.item.wholeBodyAdjudication.viewsSha256='d'.repeat(64);
  if(kind==='claimed-number')t.item.number=8;
  if(kind==='evidence-number')t.item.evidence.number=8;
  if(kind==='new-code-audit')t.item.codeAuditHistory=[{status:'unresolved',reason:'conflict'}];
  if(kind==='serialized-item')t.item=JSON.parse(JSON.stringify(t.item));
  if(kind==='label-only')t.item={file,number:7,reliable:true,evidence:{method:wholeBodyMethod}};
  assert.equal((await recheckReliablePhotoClaimsWithPdf([t.item],t.pdfPages)).confirmed,0,kind);
  assert.equal(t.item.reliable,false,kind);negatives++;
 }
 console.log(`Blank-code whole-body collector: positive source-bound join / ${negatives} negative cases PASS`);
}finally{
 const actual=fs.realpathSync(root),parent=fs.realpathSync(os.tmpdir());
 assert.equal(path.dirname(actual).toLowerCase(),parent.toLowerCase());
 assert.ok(path.basename(actual).startsWith('qifu-body-only-collector-'));
 fs.rmSync(actual,{recursive:true,force:true});
}
console.log('Blank-code whole-body collector synthetic regression PASS');
