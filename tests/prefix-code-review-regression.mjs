import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {reviewCurrentPdfBodies} from '../src/body-content-review.mjs';
import {codeBodyTestInput,views,freshItem} from './code-body-adjudication-regression.mjs';
import * as reviewModule from '../src/code-model-review.mjs';
import {CHINESE_BODY_MODEL_SHA256} from '../src/chinese-body-reader.mjs';
import {SERVER_CODE_MODEL_SHA256} from './experiments/server-code-reader.mjs';
import {adjudicateCodeBody,retainCodeBodyResolution,codeBodyResolution} from '../src/code-body-adjudication.mjs';
const sharp=createRequire(import.meta.url)('sharp'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const source=await sharp({create:{width:200,height:100,channels:3,background:'#ccc'}}).png().toBuffer();
// Synthetic protocol responses over real crop bytes. Not an OCR accuracy test.
function input(){
 const x=codeBodyTestInput();x.photoSha256=x.read.inputSha256=sha(source);x.read.expectedPrefix=x.expectedPrefix;
 for(const o of [...x.read.observations,...x.read.readings.filter(r=>r.engine==='paddle')]){
  o.fullCode='283-1-17';o.prefix='283';o.number=17;o.confidence=.95;
 }
 return x;
}
async function prior(x,{text='263-1-17',confidence=.75}={}){
 let calls=0;return reviewModule.observeCodeModel({source,read:x.read,reader:{modelSha256:CHINESE_BODY_MODEL_SHA256,
  readLine:async()=>({text,confidence:++calls===1?.9:confidence})}});
}
async function chain(x,{text='263-1-17',confidence=.95}={}){
 return reviewModule.observePrefixCodeReview?.({source,read:x.read,priorReview:x.alternateCodeReview,
  reader:{modelSha256:SERVER_CODE_MODEL_SHA256,readLine:async()=>({text,confidence})}});
}
const x=input();x.alternateCodeReview=await prior(x);
assert.notEqual(adjudicateCodeBody(x).status,'resolved','old one-model/original-full-code gate remains intact');
x.prefixCodeReview=await chain(x);
assert.equal(adjudicateCodeBody(x).status,'resolved','stable original tail, two source-bound prefix reads and specific paired PDF body');
assert.equal(adjudicateCodeBody(x).number,17);
assert.equal(adjudicateCodeBody(x).codePolicy,'stable-original-tail-plus-two-prefix-models-v1');
for(const priorReview of [undefined,null,{},structuredClone(x.alternateCodeReview)]) {
 assert.equal(reviewModule.prefixCodeReviewEvidence(x.prefixCodeReview,priorReview,x.read,x.photoSha256),null,
  'missing/stale prior must reject safely rather than abort the whole plan');
}
for(const read of [undefined,null])assert.equal(reviewModule.prefixCodeReviewEvidence(x.prefixCodeReview,x.alternateCodeReview,read,x.photoSha256),null);
// Exercise the actual collector, not just the pure adjudicator. An already
// sufficient source-bound prefix/body chain must not trigger expensive layout.
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-prefix-collector-'));
try {
 const file=path.join(scratch,'synthetic.png'),pdf=path.join(scratch,'synthetic.pdf');
 fs.writeFileSync(file,source);fs.writeFileSync(pdf,'synthetic PDF bytes');
 const current=input(),pdfSha256=sha(fs.readFileSync(pdf));
 current.alternateCodeReview=await prior(current);current.prefixCodeReview=await chain(current);
 current.pages.forEach(p=>p.pdfSha256=pdfSha256);
 const item=freshItem(current);
 Object.assign(item,{file,sourceSha256:current.photoSha256,alternateCodeReview:current.alternateCodeReview,prefixCodeReview:current.prefixCodeReview});
 const messages=[];
 const result=await reviewCurrentPdfBodies({appRoot:scratch,pdfFiles:[pdf],
  pdfPages:[{pdf,pageNumber:1,number:17},{pdf,pageNumber:2,number:18}],
  pdfIndexBinding:{digest:sha('set'),files:[{name:path.basename(pdf),sha256:pdfSha256}]},
  claims:[],unresolvedClaims:[item],loadPages:async()=>current.pages,
  createReader:async()=>({read:async()=>current.views,release:async()=>{}}),onProgress:m=>messages.push(m)});
 assert.equal(result.adjudicated.length,1,'prefix evidence must reach final collector');
 assert.equal(result.positionedLayoutReview.status,'not-needed','resolved prefix/body evidence was dropped during residual selection');
 assert.equal(messages.some(m=>m.startsWith('位置版式')),false,'no unnecessary layout work after sufficient prefix/body evidence');
} finally {
 const resolved=fs.realpathSync(scratch),temp=fs.realpathSync(os.tmpdir());
 assert.equal(path.dirname(resolved).toLowerCase(),temp.toLowerCase());
 assert(path.basename(resolved).startsWith('qifu-prefix-collector-'));
 fs.rmSync(resolved,{recursive:true,force:true});
}
const before=JSON.stringify(x);adjudicateCodeBody(x);assert.equal(JSON.stringify(x),before);
for(const kind of ['wrong-tail','two-prefix-edits','original-opposite-consensus','multiple-regions','weak-original','prior-foreign','prior-low','prior-failed','prior-cloned','server-foreign','server-low','server-cloned','server-mutated','base-mutated','contrary-body','shared-body','duplicate-body','missing-pdf']){
 const y=input();
 if(kind==='wrong-tail')for(const o of [...y.read.observations,...y.read.readings.filter(r=>r.engine==='paddle')]){o.fullCode='283-1-18';o.number=18;}
 if(kind==='two-prefix-edits')for(const o of [...y.read.observations,...y.read.readings.filter(r=>r.engine==='paddle')]){o.fullCode='299-1-17';o.prefix='299';}
 if(kind==='weak-original'){y.read.observations[1].confidence=.84;y.read.readings[1].confidence=.84;}
 if(kind==='original-opposite-consensus')for(const o of [...y.read.independent,...y.read.readings.filter(r=>r.engine==='tesseract')]){o.fullCode='283-1-17';o.prefix='283';o.number=17;o.confidence=90;}
 if(kind==='multiple-regions'){
  y.read.regions=2;y.read.coverage.eligibleRegions=y.read.coverage.processedRegions=2;
  y.read.readings.push(...structuredClone(y.read.readings).map(r=>({...r,index:1,crop:{...r.crop,left:r.crop.left+90}})));
  for(const key of ['observations','independent'])y.read[key].push(...structuredClone(y.read[key]).map(r=>({...r,index:1,crop:{...r.crop,left:r.crop.left+90}})));
 }
 y.alternateCodeReview=await prior(y,{text:kind==='prior-foreign'?'283-1-17':'263-1-17',confidence:kind==='prior-low'?.64:.75});
 if(kind==='prior-cloned')y.alternateCodeReview=structuredClone(y.alternateCodeReview);
 if(kind==='prior-failed')y.alternateCodeReview={completed:false};
 try{y.prefixCodeReview=await chain(y,{text:kind==='server-foreign'?'283-1-17':'263-1-17',confidence:kind==='server-low'?.84:.95});}catch{}
 if(kind==='server-cloned')y.prefixCodeReview=structuredClone(y.prefixCodeReview);
 if(kind==='server-mutated')y.prefixCodeReview.rows[0].confidence=.96;
 if(kind==='base-mutated')y.read.independent[0].confidence=19;
 if(kind==='contrary-body')y.views=views('海月澄明\n竹影清幽');
 if(kind==='shared-body')y.views=views('阖家平安');
 if(kind==='duplicate-body')y.pages[1]={...structuredClone(y.pages[0]),pageNumber:2};
 if(kind==='missing-pdf')y.pages.pop();
 assert.notEqual(adjudicateCodeBody(y).status,'resolved',kind);
}
const retained=input();retained.alternateCodeReview=await prior(retained);retained.prefixCodeReview=await chain(retained);
const item=freshItem(retained);Object.assign(item,{sourceSha256:retained.photoSha256,detectedCodeRead:retained.read,
 alternateCodeReview:retained.alternateCodeReview,prefixCodeReview:retained.prefixCodeReview});
const audit=JSON.stringify(item.codeAuditHistory);
assert.equal(retainCodeBodyResolution(item,{...retained,pdfSetDigest:'d'.repeat(64)}).status,'resolved');
assert.equal(codeBodyResolution(item).number,17);assert.equal(JSON.stringify(item.codeAuditHistory),audit);
item.prefixCodeReview.rows[0].confidence=.96;assert.equal(codeBodyResolution(item),null);
const failed=input();failed.alternateCodeReview=await prior(failed);
const changedPrior=input();changedPrior.alternateCodeReview=await prior(changedPrior);
await assert.rejects(()=>reviewModule.observePrefixCodeReview({source,read:changedPrior.read,priorReview:changedPrior.alternateCodeReview,
 reader:{modelSha256:SERVER_CODE_MODEL_SHA256,readLine:async()=>{changedPrior.alternateCodeReview.rows[0].confidence=.91;return {text:'263-1-17',confidence:.99};}}}),/prior-changed/);
const changedBase=input();changedBase.alternateCodeReview=await prior(changedBase);
await assert.rejects(()=>reviewModule.observePrefixCodeReview({source,read:changedBase.read,priorReview:changedBase.alternateCodeReview,
 reader:{modelSha256:SERVER_CODE_MODEL_SHA256,readLine:async()=>{changedBase.read.independent[0].confidence=19;return {text:'263-1-17',confidence:.99};}}}),/base-changed/);
for(const modelSha256 of [CHINESE_BODY_MODEL_SHA256,'0'.repeat(64)])await assert.rejects(()=>reviewModule.observePrefixCodeReview({source,read:failed.read,priorReview:failed.alternateCodeReview,reader:{modelSha256}}));
await assert.rejects(()=>reviewModule.observePrefixCodeReview({source:Buffer.from('changed'),read:failed.read,priorReview:failed.alternateCodeReview,reader:{modelSha256:SERVER_CODE_MODEL_SHA256}}));
let calls=0;await assert.rejects(()=>reviewModule.observePrefixCodeReview({source,read:failed.read,priorReview:failed.alternateCodeReview,
 reader:{modelSha256:SERVER_CODE_MODEL_SHA256,readLine:async()=>{if(++calls===2)throw Error('failed');return {text:'263-1-17',confidence:.99};}}}));
console.log('Prefix-only review PASS: original tail and opposite-code vetoes, live two-model chain, paired body, immutable audit');
