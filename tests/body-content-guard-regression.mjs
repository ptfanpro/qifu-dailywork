import assert from 'node:assert/strict';
import * as photo from '../src/photo-prepare.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {assessBodyClaim,bodyReviewBlockReason,retainBodyReview,reviewCurrentPdfBodies} from '../src/body-content-review.mjs';
import {visualBodyViewNames,buildVisualBodyPages} from '../src/pdf-visual-body-evidence.mjs';

// Two agreeing number engines cannot erase an independent body/revision hold.
// Synthetic identity only: no historical customer words or known target hash.
const make = () => ({file:'not-read.jpg', number:8, reliable:true,
  paperGeometry:{usablePaper:true,rectangularPaper:true,width:.7,height:.6},
  evidence:{method:'paddleocr-onnx-adaptive-right-line-consensus',votes:4,prefixDistance:0,maxConfidence:91},
  candidates:[], bodyReviewHistory:[{schemaVersion:1,status:'conflicting-body',claimedNumber:8,
    photoSha256:'a'.repeat(64),pdfSetDigest:'b'.repeat(64),bindingVerified:false}]});
const item=make();
const result=await photo.recheckReliablePhotoClaimsWithPdf([item],[{number:8,_localShapeFingerprint:[1]}]);
assert.equal(result.confirmed,0,'code consensus must not overrule a retained body-content conflict');
assert.equal(item.reliable,false);
assert.equal(photo.isLikelyScene({...item,visualMetrics:{edgeDensity:.001}}),false);
assert.deepEqual(photo.resolveAmbiguousPhotosByGlobalSet([item],new Set([6,8]),new Set([6])),[]);
console.log('Body content conflict retention PASS');

const views=texts=>visualBodyViewNames.map((view,i)=>({view,text:Array.isArray(texts)?texts[i]:texts,errors:0,truncated:false}));
const corpus=[{pdfSha256:'c'.repeat(64),pageNumber:1,fieldTexts:['山川日月春风秋雨'],supplementalText:[]},
  {pdfSha256:'c'.repeat(64),pageNumber:2,fieldTexts:['江河湖海星辰草木'],supplementalText:[]}];
assert.equal(assessBodyClaim(views('江河湖海星辰草木'),corpus,corpus[0]).status,'conflicting-body');
assert.equal(assessBodyClaim(views('山川日月春风秋雨。江河湖海星辰草木'),corpus,corpus[0]).status,'conflicting-body','top claim cannot hide another page');
assert.equal(assessBodyClaim(views(['江河湖海星辰草木','','','']),corpus,corpus[0]).status,'ambiguous-body');
assert.equal(assessBodyClaim(views('山川日月春风秋雨'),corpus,corpus[0]).status,'observed-body-consistent');
assert.equal(assessBodyClaim(views('269-1-8'),corpus,corpus[0]).status,'no-specific-body-evidence');
assert.equal(assessBodyClaim(views('山川日月春风秋雨'),corpus,corpus[0]).bindingVerified,false);
assert.throws(()=>assessBodyClaim(views('').slice(1),corpus,corpus[0]),/Incomplete/);
assert.throws(()=>assessBodyClaim(views(''),[...corpus,corpus[0]],corpus[0]),/identity/);
const partial=views('');partial[1].errors=1;
assert.equal(assessBodyClaim(partial,corpus,corpus[0]).status,'body-reader-unavailable');
const hiddenTemplate=buildVisualBodyPages([
  {pdfSha256:'d'.repeat(64),pageNumber:1,fieldTexts:['共同模板固定文案']},
  {pdfSha256:'d'.repeat(64),pageNumber:2,fieldTexts:['中央变量正文']},
],[1,2].map(pageNumber=>({pdfSha256:'d'.repeat(64),pageNumber,views:views('共同模板固定文案')})));
assert.equal(assessBodyClaim(views('共同模板固定文案'),hiddenTemplate,hiddenTemplate[1]).status,'no-specific-body-evidence');
const frozen=make();
retainBodyReview(frozen,{...frozen.bodyReviewHistory[0],status:'observed-body-consistent'});
assert.ok(bodyReviewBlockReason(frozen),'later apparent success cannot erase a conflict');
assert.equal(frozen.reliable,false);
const serialized=JSON.stringify(assessBodyClaim(views('江河湖海星辰草木'),corpus,corpus[0]));
assert.doesNotMatch(serialized,/江河|草木|山川/);
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-body-guard-test-'));
try {
  const pdf=path.join(scratch,'a.pdf'),file=path.join(scratch,'photo.jpg');
  fs.writeFileSync(pdf,'synthetic pdf');fs.writeFileSync(file,'synthetic photo');
  const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
  const pdfHash=sha(fs.readFileSync(pdf));
  const binding={digest:'b'.repeat(64),files:[{name:'a.pdf',sha256:pdfHash}]};
  const pages=corpus.map(p=>({...p,pdfSha256:pdfHash}));
  const pdfPages=[1,2].map(pageNumber=>({pdf,pageNumber,number:pageNumber===1?8:6}));
  const claims=()=>[{file,number:8,reliable:true}];
  let released=0;
  const fakeReader=async()=>({read:async()=>views('江河湖海星辰草木'),release:async()=>released++});
  const targets=claims();
  const actual=await reviewCurrentPdfBodies({appRoot:scratch,pdfFiles:[pdf],pdfPages,pdfIndexBinding:binding,claims:targets,
    createReader:fakeReader,loadPages:async()=>pages});
  assert.equal(actual.blocked,1);
  assert.equal(actual.results[0].status,'conflicting-body');
  assert.equal(targets[0].number,null,'never automatically assign the body candidate');
  assert.equal(released,1);
  for(const loadPages of [async()=>pages.slice(0,1),async()=>[pages[0],pages[0]],async()=>{
    fs.writeFileSync(pdf,'changed pdf');return pages;
  }]) {
    const bad=await reviewCurrentPdfBodies({appRoot:scratch,pdfFiles:[pdf],pdfPages,pdfIndexBinding:binding,claims:claims(),createReader:fakeReader,loadPages});
    assert.equal(bad.results[0].status,'body-reader-unavailable');
    assert.equal(bad.blocked,1);
  }
  fs.writeFileSync(pdf,'synthetic pdf');
  const absent=await reviewCurrentPdfBodies({appRoot:scratch,pdfFiles:[pdf],pdfPages,pdfIndexBinding:binding,claims:claims(),
    createReader:async()=>{throw Error('Missing models');}});
  assert.equal(absent.blocked,1,'missing model must not silently disable review');
} finally {fs.rmSync(scratch,{recursive:true,force:true});}
console.log('Body content evidence and actual collector negative/positive regressions PASS');
