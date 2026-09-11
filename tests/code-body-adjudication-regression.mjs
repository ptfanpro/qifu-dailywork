import assert from 'node:assert/strict';
import {adjudicateCodeBody,codeBodyResolution,retainCodeBodyResolution} from '../src/code-body-adjudication.mjs';
import {photoCodeAuditBlockReason} from '../src/photo-prepare.mjs';
import {visualBodyViewNames,buildVisualBodyPages} from '../src/pdf-visual-body-evidence.mjs';
const hash='a'.repeat(64),pdfHash='b'.repeat(64);
const views=(text,second=text)=>visualBodyViewNames.map((view,i)=>({view,text:i<2?[text,second][i]:'',errors:0,truncated:false}));
const fields=['松风清境','晨光普照','阖家平安'];
const other=['海月澄明','竹影清幽','阖家平安'];
const pages=buildVisualBodyPages([fields,other].map((fieldTexts,i)=>({pdfSha256:pdfHash,pageNumber:i+1,fieldTexts})),
  [fields,other].map((f,i)=>({pdfSha256:pdfHash,pageNumber:i+1,views:views(f.join('\n'))})));
const crop=p=>({left:Math.round(20-p*10),top:Math.round(20-p*10),width:Math.round(40+p*20),height:Math.round(10+p*20)});
const row=(engine,padding,fullCode='263-1-17',confidence=engine==='paddle'?.99:20)=>({engine,padding,
  fullCode,prefix:fullCode.split('-')[0],number:Number(fullCode.split('-')[2]),confidence,index:0,crop:crop(padding)});
function input(){
  const observations=[.45,.75].map(p=>row('paddle',p));
  const independent=[.45,.75].map(p=>row('tesseract',p,'263-1-171',20));
  return {read:{observations,independent,regions:1,engines:2,errors:0,incompleteTailObserved:false,
    inputSha256:hash,sourceDimensions:{width:200,height:100},
    readings:[...observations,...independent].map(o=>({...o,errorCode:null,codeCount:1,incompleteTailObserved:false})),
    coverage:{kind:'detected-horizontal-regions',eligibleRegions:1,processedRegions:1,completed:true}},
    expectedPrefix:'263',photoSha256:hash,pages:structuredClone(pages),views:views(fields.join('\n')),
    index:[{pdfSha256:pdfHash,pageNumber:1,number:17},{pdfSha256:pdfHash,pageNumber:2,number:18}]};
}
const run=change=>{const x=input();change?.(x);return adjudicateCodeBody(x);};
assert.equal(run().status,'resolved');
assert.equal(run().number,17);
assert.equal(run().weakAlternatives,2);
assert.equal(run(x=>{x.read.independent=[];x.read.readings=x.read.readings.map(o=>o.engine==='tesseract'?{...o,codeCount:0}:o);}).status,'resolved');
const reject=(label,change)=>assert.notEqual(run(change).status,'resolved',label);
reject('a short shared name is not an identity',x=>{x.views=views('阖家平安');});
reject('one unique field is insufficient',x=>{x.views=views(fields[0]);});
reject('different fields in the two crops cannot be pooled',x=>{x.views=views(fields[0],fields[1]);});
reject('one failed body view',x=>{x.views[3].errors=1;});
reject('mixed pages cannot be outweighed by a larger score',x=>{x.views=views([...fields,other[0]].join('\n'));});
reject('one contrary body view also blocks',x=>{x.views=views(fields.join('\n'),[...fields,other[0]].join('\n'));});
reject('code and body point at different pages',x=>{x.views=views(other.join('\n'));});
reject('identical bodies remain ambiguous',x=>{x.pages[1]={...x.pages[0],pageNumber:2};});
reject('incomplete PDF corpus',x=>{x.pages=x.pages.slice(0,1);});
reject('duplicate numeric index',x=>{x.index[1].number=17;});
reject('duplicate physical page index',x=>{x.index[1].pageNumber=1;});
reject('a filename-like number does not replace a full code',x=>{x.read.observations=[];});
reject('credible contrary Tesseract code',x=>{x.read.independent[0].confidence=30;x.read.readings[2].confidence=30;});
reject('credible contrary Paddle code including foreign prefix',x=>{x.read.observations[1]=row('paddle',.75,'283-1-17',.89);x.read.readings[1]={...x.read.observations[1],codeCount:1,errorCode:null,incompleteTailObserved:false};});
reject('one good crop is insufficient',x=>{x.read.observations[1].confidence=.84;x.read.readings[1].confidence=.84;});
reject('missing observation confidence is not low confidence',x=>{delete x.read.independent[0].confidence;});
reject('missing scan of a blank region',x=>{x.read.readings.pop();});
reject('truncated scan',x=>{x.read.coverage.completed=false;});
reject('partial tail',x=>{x.read.incompleteTailObserved=true;});
reject('changed input bytes',x=>{x.photoSha256='c'.repeat(64);});
reject('invalid crop',x=>{x.read.observations[0].crop.left=-1;});
reject('forged number field',x=>{x.read.observations[0].number=18;});
reject('a missing code cannot be filled from PDF contents',x=>{x.read.observations=[];x.read.independent=[];x.read.readings.forEach(o=>o.codeCount=0);});
const x=input(),before=JSON.stringify(x);adjudicateCodeBody(x);assert.equal(JSON.stringify(x),before,'no input or raw audit mutation');
assert.doesNotMatch(JSON.stringify(run()),/松风|晨光|海月|竹影/,'receipts contain hashes/counts, not private body fields');
function freshItem(x){return {number:null,reliable:false,sourceSha256:hash,detectedCodeRead:{...x.read,expectedPrefix:'263'},
  codeAuditHistory:[{status:'unresolved',number:null,reason:'detected-code-number-conflict',
    observations:[...x.read.observations,...x.read.independent].map(o=>({...o,cropBounds:o.crop}))}]};}
const subject=freshItem(x),history=JSON.stringify(subject.codeAuditHistory);
assert.ok(photoCodeAuditBlockReason(subject));
const joined=retainCodeBodyResolution(subject,{...x,pdfSetDigest:'d'.repeat(64)});
assert.equal(joined.status,'resolved',JSON.stringify(joined));
assert.equal(photoCodeAuditBlockReason(subject),null);
assert.equal(JSON.stringify(subject.codeAuditHistory),history,'original conflicting observations retained unchanged');
assert.equal(codeBodyResolution(subject).number,17);
assert.ok(photoCodeAuditBlockReason(structuredClone(subject)),'serialized receipt cannot authorize a new computation');
subject.detectedCodeRead.independent[0].confidence=99;
assert.ok(photoCodeAuditBlockReason(subject),'raw evidence changes revoke authorization');
for(const reason of ['independent-code-audit-conflicting','detected-code-reader-incomplete']){
  const old=freshItem(input());old.codeAuditHistory[0].reason=reason;
  assert.notEqual(retainCodeBodyResolution(old,{...input(),pdfSetDigest:'d'.repeat(64)}).status,'resolved');
}
const prior=freshItem(input());prior.pdfRecheck={status:'rejected'};
assert.notEqual(retainCodeBodyResolution(prior,{...input(),pdfSetDigest:'d'.repeat(64)}).status,'resolved');
console.log('Code/body adjudication regression PASS: positive join, safety and retained-audit gates');
export {input as codeBodyTestInput,freshItem,views};
