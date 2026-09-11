import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {codeBodyTestInput,freshItem,views} from './code-body-adjudication-regression.mjs';
import {observeCodeModel,codeModelReviewEvidence} from '../src/code-model-review.mjs';
import {CHINESE_BODY_MODEL_SHA256} from '../src/chinese-body-reader.mjs';
import {adjudicateCodeBody,codeBodyCandidateForItem,codeBodyModelReviewEligible,retainCodeBodyResolution,codeBodyResolution} from '../src/code-body-adjudication.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const source=await sharp({create:{width:200,height:100,channels:3,background:'red'}}).png().toBuffer();
// Synthetic reader return values over real crop bytes test the protocol and
// decision boundary, not recognition accuracy. Private real-photo replay is
// separate; no customer pixels, body text or identifiers are stored here.
function input(){
 const x=codeBodyTestInput();x.photoSha256=x.read.inputSha256=sha(source);x.read.expectedPrefix=x.expectedPrefix;
 for(const o of [...x.read.independent,...x.read.readings.filter(r=>r.engine==='tesseract')]){
  o.fullCode='283-1-17';o.prefix='283';o.number=17;o.confidence=65;
 }
 return x;
}
async function review(x,text='263-1-17',confidence=.99){
 let calls=0;
 const report=await observeCodeModel({source,read:x.read,reader:{modelSha256:CHINESE_BODY_MODEL_SHA256,
  readLine:async bytes=>{assert(Buffer.isBuffer(bytes));calls++;return {text,confidence};}}});
 assert.equal(calls,2*new Set([...x.read.observations,...x.read.independent].map(o=>o.index)).size,'all original code-region pads must be read');return report;
}
const x=input(),item=freshItem(x);item.sourceSha256=x.photoSha256;item.detectedCodeRead=x.read;
assert.equal(codeBodyModelReviewEligible(item,x.index),true);
assert.notEqual(codeBodyCandidateForItem(item,x.index).status,'candidate');
const originalAudit=JSON.stringify(item.codeAuditHistory),originalRead=JSON.stringify(x.read);
x.alternateCodeReview=await review(x);item.alternateCodeReview=x.alternateCodeReview;
assert.equal(adjudicateCodeBody(x).status,'resolved','fresh alternate original-crop observation plus paired actual body resolves a model disagreement');
assert.equal(retainCodeBodyResolution(item,{...x,pdfSetDigest:'d'.repeat(64)}).status,'resolved');
assert.equal(codeBodyResolution(item).number,17);
assert.equal(JSON.stringify(item.codeAuditHistory),originalAudit);
assert.equal(JSON.stringify(x.read),originalRead);
assert.notEqual(adjudicateCodeBody({...x,alternateCodeReview:structuredClone(x.alternateCodeReview)}).status,'resolved','serialized label cannot authorize review');
assert.notEqual(adjudicateCodeBody({...x,views:views('海月澄明\n竹影清幽')}).status,'resolved','opposite physical page body vetoes stable code');
assert.notEqual(adjudicateCodeBody({...x,views:views('阖家平安')}).status,'resolved','shared body is not page identity');
assert.notEqual(adjudicateCodeBody({...x,pages:x.pages.slice(0,1)}).status,'resolved','incomplete current corpus');
for(const kind of ['low-score','foreign','opposite-consensus','another-region','more-than-one-edit','missing-correct-original']){
 const y=input();
 if(kind==='opposite-consensus'||kind==='missing-correct-original')for(const o of [...y.read.observations,...y.read.readings.filter(r=>r.engine==='paddle')]){o.fullCode='283-1-17';o.prefix='283';}
 if(kind==='opposite-consensus'){
  y.read.observations.push({...y.read.observations[0],fullCode:'263-1-17',prefix:'263'});
  y.read.readings[0].codeCount=2;
 }
 if(kind==='another-region'){
  y.read.regions=2;y.read.coverage.eligibleRegions=y.read.coverage.processedRegions=2;
  const otherRows=y.read.readings.map(r=>({...r,index:1,crop:{...r.crop,left:r.crop.left+90},codeCount:0}));
  const foreign={...otherRows[0],fullCode:'283-1-17',prefix:'283',number:17,confidence:.99};
  otherRows[0].codeCount=1;otherRows[0].confidence=.99;
  y.read.readings.push(...otherRows);y.read.observations.push(foreign);
 }
 if(kind==='more-than-one-edit')for(const o of [...y.read.independent,...y.read.readings.filter(r=>r.engine==='tesseract')]){o.fullCode='299-1-92';o.prefix='299';o.number=92;}
 y.alternateCodeReview=await review(y,kind==='foreign'?'283-1-17':'263-1-17',kind==='low-score'?.84:.99);
 assert.notEqual(adjudicateCodeBody(y).status,'resolved',kind);
}
// The alternate model need not repeat the original Paddle result. A correct
// complete observation from Tesseract can seed the candidate, but actual body
// corroboration is still mandatory (not a majority vote among OCR models).
const tessSeed=input();
for(const o of [...tessSeed.read.observations,...tessSeed.read.readings.filter(r=>r.engine==='paddle')]){o.fullCode='283-1-17';o.prefix='283';}
for(const o of [...tessSeed.read.independent,...tessSeed.read.readings.filter(r=>r.engine==='tesseract')]){o.fullCode='263-1-17';o.prefix='263';}
tessSeed.alternateCodeReview=await review(tessSeed);
assert.equal(adjudicateCodeBody(tessSeed).status,'resolved');
assert.notEqual(adjudicateCodeBody({...tessSeed,views:views('海月澄明\n竹影清幽')}).status,'resolved');
const missingCrop=input();missingCrop.read.readings=missingCrop.read.readings.filter(r=>!(r.engine==='paddle'&&r.padding===.75));
await assert.rejects(()=>review(missingCrop),/alternate-code-crop-coverage/);
const native=input();native.read.nativeScaleReview={read:structuredClone(native.read)};
await assert.rejects(()=>review(native),/alternate-code-budget-or-scale/);
const duringRead=input();
await assert.rejects(()=>observeCodeModel({source,read:duringRead.read,reader:{modelSha256:CHINESE_BODY_MODEL_SHA256,
 readLine:async()=>{duringRead.read.independent[0].confidence=64;return {text:'263-1-17',confidence:.99};}}}),/alternate-code-base-changed/);
await assert.rejects(()=>observeCodeModel({source,read:input().read,reader:{modelSha256:CHINESE_BODY_MODEL_SHA256,
 readLine:async()=>({text:'263-1-17',confidence:NaN})}}),/alternate-code-confidence/);
const altered=input();altered.alternateCodeReview=await review(altered);
altered.alternateCodeReview.rows[0].confidence=.98;
assert.equal(codeModelReviewEvidence(altered.alternateCodeReview,altered.read,altered.photoSha256),null);
const changed=input();changed.alternateCodeReview=await review(changed);changed.read.independent[0].confidence=64;
assert.equal(codeModelReviewEvidence(changed.alternateCodeReview,changed.read,changed.photoSha256),null);
item.alternateCodeReview.rows[0].confidence=.98;assert.equal(codeBodyResolution(item),null,'changing supplemental evidence revokes retained authorization');
await assert.rejects(()=>observeCodeModel({source:Buffer.from('changed'),read:input().read,reader:{modelSha256:CHINESE_BODY_MODEL_SHA256}}));
await assert.rejects(()=>observeCodeModel({source,read:input().read,reader:{modelSha256:'0'.repeat(64)}}));
let attempted=0;
await assert.rejects(()=>observeCodeModel({source,read:input().read,reader:{modelSha256:CHINESE_BODY_MODEL_SHA256,
 readLine:async()=>{if(++attempted===2)throw Error('reader-failed');return {text:'263-1-17',confidence:.99};}}}));
const prior=freshItem(input());prior.sourceSha256=sha(source);prior.pdfRecheck={status:'rejected'};
assert.equal(codeBodyModelReviewEligible(prior,input().index),false,'a prior physical review cannot be waived');
console.log('Alternate model code review PASS: actual crop protocol, source seal, ambiguity resolution and contrary-content veto');
