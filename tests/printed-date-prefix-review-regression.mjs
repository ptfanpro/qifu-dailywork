import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {codeBodyTestInput,freshItem} from './code-body-adjudication-regression.mjs';
import {observeCodeModel} from '../src/code-model-review.mjs';
import {CHINESE_BODY_MODEL_SHA256} from '../src/chinese-body-reader.mjs';
import {adjudicateCodeBody,retainCodeBodyResolution,codeBodyResolution} from '../src/code-body-adjudication.mjs';
import {visualBodyViewNames,buildVisualBodyPages} from '../src/pdf-visual-body-evidence.mjs';
import {horizontalBodyCrop} from '../src/vertical-body-regions.mjs';
const sharp=createRequire(import.meta.url)('sharp'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const source=await sharp({create:{width:200,height:100,channels:3,background:'#ccc'}}).png().toBuffer();
const heading='2026年03月14日供灯祈愿';
function fieldViews(terms){
 return visualBodyViewNames.map((view,i)=>{
  const dimensions={width:200,height:100};
  const fields=i<2?terms.map((text,j)=>{
   const region={left:.05,top:.08+j*.20,width:.80,height:.05,score:.99};
   return {text,confidence:.99,regionIndex:j,region,crop:horizontalBodyCrop(region,dimensions,i===0?.35:.65)};
  }):[];
  return {view,text:fields.map(f=>f.text).join('。'),errors:0,truncated:false,regions:fields.length,lineCount:fields.length,
   positioned:{schemaVersion:1,dimensions,fields}};
 });
}
export async function printedDateInput({mutate,alternate='283-1-17'}={}){
 const x=codeBodyTestInput();x.read.inputSha256=x.photoSha256=hash(source);x.read.expectedPrefix=x.expectedPrefix;
 x.read.independent=[];
 for(const r of x.read.readings.filter(r=>r.engine==='tesseract'))r.codeCount=0;
 for(const r of [...x.read.observations,...x.read.readings.filter(r=>r.engine==='paddle')]){
  r.fullCode='283-1-17';r.prefix='283';r.number=17;r.confidence=.95;
 }
 const terms=[[heading,'松风清境','晨光普照'],[heading,'海月澄明','竹影清幽']];
 x.views=fieldViews(terms[0]);
 x.pages=buildVisualBodyPages(terms.map((fieldTexts,i)=>({...x.index[i],fieldTexts})),
  terms.map((t,i)=>({...x.index[i],views:fieldViews(t)})));
 mutate?.(x);
 x.alternateCodeReview=await observeCodeModel({source,read:x.read,reader:{modelSha256:CHINESE_BODY_MODEL_SHA256,
  readLine:async()=>({text:alternate,confidence:.96})}});
 return x;
}
const positive=await printedDateInput(),raw=JSON.stringify(positive);
const result=adjudicateCodeBody(positive);
assert.equal(result.status,'resolved','observed printed date and paired whole PDF fields must adjudicate a stable prefix-only ambiguity');
assert.equal(result.number,17);assert.equal(result.codePolicy,'stable-tail-printed-date-current-body-v1');
assert.equal(result.printedDateSupport.date,'2026-03-14');
assert.equal(result.fullCodeObserved,false,'do not claim the reconstructed prefix was a literal full-code OCR result');
assert.equal(JSON.stringify(positive),raw);
const pdfGlyph=await printedDateInput();
for(const page of pdfGlyph.pages){
 page.visibleFieldViews[0].text=page.visibleFieldViews[0].text.replace('祈愿','祈原');
 page.supplementalText=page.visibleFieldViews.map(v=>v.text);
}
assert.equal(adjudicateCodeBody(pdfGlyph).status,'resolved','a non-date final PDF OCR glyph cannot invalidate independently extracted and paired visible date digits');
const rejected=[];
async function reject(label,change,options){const x=await printedDateInput(options);change?.(x);
 assert.notEqual(adjudicateCodeBody(x).status,'resolved',label);rejected.push(label);}
await reject('no printed date',x=>x.views=fieldViews(['松风清境','晨光普照']));
await reject('unlabelled birthday is not business date',x=>x.views=fieldViews(['2026年03月14日','松风清境','晨光普照']));
await reject('other day',x=>x.views=fieldViews(['2026年03月15日供灯祈愿','松风清境','晨光普照']));
await reject('other month',x=>x.views=fieldViews(['2026年08月14日供灯祈愿','松风清境','晨光普照']));
await reject('one-view header',x=>{x.views[1]=fieldViews(['松风清境','晨光普照'])[1];});
await reject('one field only',x=>x.views=fieldViews([heading,'松风清境']));
await reject('body of another page',x=>x.views=fieldViews([heading,'海月澄明','竹影清幽']));
await reject('mixed body',x=>x.views=fieldViews([heading,'松风清境','晨光普照','海月澄明']));
await reject('duplicate page body',x=>{x.pages[1]={...structuredClone(x.pages[0]),pageNumber:2};});
await reject('no extracted PDF heading',x=>{x.pages[0].fieldTexts=x.pages[0].fieldTexts.slice(1);});
await reject('no paired visible PDF heading',x=>{x.pages[0].visibleFieldViews[1].text='松风清境。晨光普照';});
await reject('PDF header fragments must not be assembled',x=>{x.pages[0].fieldTexts=['2026年03月14日','供灯祈愿',...x.pages[0].fieldTexts.slice(1)];});
await reject('low confidence date',x=>{for(const v of x.views.slice(0,2))v.positioned.fields[0].confidence=.84;});
await reject('changed date crop',x=>{x.views[0].positioned.fields[0].crop.left++;});
await reject('incomplete positions',x=>{delete x.views[0].positioned;});
await reject('multiple headers',x=>x.views=fieldViews([heading,'2026年03月15日供灯祈愿','松风清境','晨光普照']));
await reject('invalid date',x=>x.views=fieldViews(['2026年02月31日供灯祈愿','松风清境','晨光普照']));
await reject('other visible PDF heading',x=>{x.pages[0].visibleFieldViews[2].text='2026年03月15日供灯祈愿';});
await reject('PDF OCR date differs even with a non-date glyph error',x=>{x.pages[0].visibleFieldViews[0].text='2026年03月15日供灯祈原';});
await reject('photo must retain exact business heading',x=>{x.views=fieldViews(['2026年03月14日供灯祈原','松风清境','晨光普照']);});
await reject('different source dimensions',x=>{x.read.sourceDimensions.width++;});
await reject('partial PDF corpus',x=>{x.pages.pop();});
await reject('duplicate numeric index',x=>{x.index[1].number=17;});
await reject('weak original crop',null,{mutate:x=>{x.read.observations[1].confidence=.84;x.read.readings[1].confidence=.84;}});
await reject('changed tail in original',null,{mutate:x=>{Object.assign(x.read.observations[1],{number:18,fullCode:'283-1-18'});Object.assign(x.read.readings[1],x.read.observations[1]);}});
await reject('changed expected namespace',x=>{x.expectedPrefix='264';});
await reject('different suffix',null,{alternate:'283-1-18'});
await reject('unrelated prefix',null,{alternate:'293-1-17'});
await reject('no fresh model evidence',x=>{x.alternateCodeReview=structuredClone(x.alternateCodeReview);});
await reject('model report mutation',x=>{x.alternateCodeReview.rows[0].confidence=.97;});
await reject('different source',x=>{x.photoSha256='f'.repeat(64);});
await reject('independent opposing consensus',null,{mutate:x=>{
  x.read.independent=x.read.readings.filter(r=>r.engine==='tesseract').map(r=>({...r,fullCode:'283-1-17',prefix:'283',number:17,confidence:90}));
  for(const r of x.read.readings.filter(r=>r.engine==='tesseract'))Object.assign(r,{fullCode:'283-1-17',prefix:'283',number:17,confidence:90,codeCount:1});
 }});
const item=freshItem(positive);Object.assign(item,{sourceSha256:positive.photoSha256,alternateCodeReview:positive.alternateCodeReview});
const history=JSON.stringify(item.codeAuditHistory);
assert.equal(retainCodeBodyResolution(item,{...positive,pdfSetDigest:'d'.repeat(64)}).status,'resolved');
assert.equal(codeBodyResolution(item).number,17);assert.equal(JSON.stringify(item.codeAuditHistory),history);
item.alternateCodeReview.rows[0].confidence=.99;assert.equal(codeBodyResolution(item),null);
console.log(`Printed-date prefix: positive, ${rejected.length} rejections and retained-audit revocation PASS`);
