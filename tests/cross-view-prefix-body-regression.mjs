import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {codeBodyTestInput,views,freshItem} from './code-body-adjudication-regression.mjs';
import {observeCodeModel,observePrefixCodeReview} from '../src/code-model-review.mjs';
import {CHINESE_BODY_MODEL_SHA256} from '../src/chinese-body-reader.mjs';
import {SERVER_CODE_MODEL_SHA256} from '../src/server-code-reader.mjs';
import {adjudicateCodeBody,retainCodeBodyResolution,codeBodyResolution} from '../src/code-body-adjudication.mjs';
const sharp=createRequire(import.meta.url)('sharp'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const source=await sharp({create:{width:200,height:100,channels:3,background:'#ccc'}}).png().toBuffer();
// Synthetic protocol observations over actual crop bytes; not model accuracy.
// The date-independent defect is asymmetric evidence routing: two strong V4
// full words + one V5 word and one prefix-only alternate never reached BODY.
async function sample({correctFirst=true,priorConfidence=.95,serverConfidence=.95,secondWord='283-1-17',mutate}={}){
 const x=codeBodyTestInput();x.read.expectedPrefix=x.expectedPrefix;
 x.read.inputSha256=x.photoSha256=hash(source);
 for(const o of [...x.read.observations,...x.read.readings.filter(r=>r.engine==='paddle')]){
  o.fullCode='283-1-17';o.prefix='283';o.number=17;o.confidence=.95;
 }
 mutate?.(x);
 x.alternateCodeReview=await observeCodeModel({source,read:x.read,reader:{modelSha256:CHINESE_BODY_MODEL_SHA256,
  readLine:async()=>({text:'263-1-17',confidence:priorConfidence})}});
 let calls=0;
 try{x.prefixCodeReview=await observePrefixCodeReview({source,read:x.read,priorReview:x.alternateCodeReview,
  reader:{modelSha256:SERVER_CODE_MODEL_SHA256,readLine:async()=>({text:(++calls===1)===correctFirst?'263-1-17':secondWord,confidence:serverConfidence})}});}catch{}
 return x;
}
for(const correctFirst of [true,false]){
 const x=await sample({correctFirst}),raw=JSON.stringify(x);
 const result=adjudicateCodeBody(x);
 assert.equal(result.status,'resolved','strong cross-view prefix evidence must reach paired whole-field body verification');
 assert.equal(result.number,17);
 assert.equal(result.codePolicy,'stable-tail-cross-view-prefix-plus-body-v1');
 assert.equal(JSON.stringify(x),raw,'no raw contrary observation may be deleted');
}
const rejected=[];
async function reject(label,options={},change){const x=await sample(options);change?.(x);
 assert.notEqual(adjudicateCodeBody(x).status,'resolved',label);rejected.push(label);}
await reject('weak prior cannot replace two server views',{priorConfidence:.84});
await reject('low server confidence',{serverConfidence:.84});
await reject('no second complete word',{secondWord:''});
await reject('different tail',{secondWord:'283-1-18'});
await reject('third prefix, not the original ambiguity',{secondWord:'269-1-17'});
await reject('two words in one crop',{secondWord:'283-1-17 263-1-18'});
await reject('incomplete trailing digit',{secondWord:'283-1-17 1'});
await reject('weak original',{mutate:x=>{x.read.observations[1].confidence=.84;x.read.readings[1].confidence=.84;}});
await reject('independent original opposite consensus',{mutate:x=>{
 for(const o of [...x.read.independent,...x.read.readings.filter(r=>r.engine==='tesseract')]){o.fullCode='283-1-17';o.prefix='283';o.number=17;o.confidence=90;}
}});
await reject('no stable original suffix',{mutate:x=>{
 x.read.observations[1].number=18;x.read.observations[1].fullCode='283-1-18';
 Object.assign(x.read.readings[1],x.read.observations[1]);
}});
await reject('source mismatch',{},x=>{x.photoSha256='c'.repeat(64);});
await reject('cloned prior',{},x=>{x.alternateCodeReview=structuredClone(x.alternateCodeReview);});
await reject('cloned server review',{},x=>{x.prefixCodeReview=structuredClone(x.prefixCodeReview);});
await reject('mutated server review',{},x=>{x.prefixCodeReview.rows[0].confidence=.99;});
await reject('mutated raw read',{},x=>{x.read.independent[0].confidence=19;});
await reject('body points to another page',{},x=>{x.views=views('海月澄明\n竹影清幽');});
await reject('only one whole unique field',{},x=>{x.views=views('松风清境');});
await reject('one field per view is not a pair',{},x=>{x.views=views('松风清境','晨光普照');});
await reject('shared text only',{},x=>{x.views=views('阖家平安');});
await reject('unreadable body view',{},x=>{x.views[3].errors=1;});
await reject('non-leading contrary body',{},x=>{x.views=views('松风清境\n晨光普照\n海月澄明');});
await reject('identical PDF bodies',{},x=>{x.pages[1]={...structuredClone(x.pages[0]),pageNumber:2};});
await reject('incomplete PDF corpus',{},x=>{x.pages.pop();});
await reject('duplicate numeric index',{},x=>{x.index[1].number=17;});
const x=await sample(),item=freshItem(x);
Object.assign(item,{sourceSha256:x.photoSha256,alternateCodeReview:x.alternateCodeReview,prefixCodeReview:x.prefixCodeReview});
const audit=JSON.stringify(item.codeAuditHistory);
assert.equal(retainCodeBodyResolution(item,{...x,pdfSetDigest:'d'.repeat(64)}).status,'resolved');
assert.equal(codeBodyResolution(item).number,17);assert.equal(JSON.stringify(item.codeAuditHistory),audit);
item.prefixCodeReview.rows[0].confidence=.99;assert.equal(codeBodyResolution(item),null);
console.log(`Cross-view prefix/body: 2 positive orientations, ${rejected.length} rejection cases, retained-audit revocation PASS`);
