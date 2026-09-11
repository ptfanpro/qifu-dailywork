import assert from 'node:assert/strict';
import {adjudicateCodeBody,codeBodyResolution,retainCodeBodyResolution} from '../src/code-body-adjudication.mjs';
import {photoCodeAuditBlockReason} from '../src/photo-prepare.mjs';
import {visualBodyViewNames,buildVisualBodyPages} from '../src/pdf-visual-body-evidence.mjs';
import {horizontalBodyCrop,verticalBodyCrop} from '../src/vertical-body-regions.mjs';
const hash='a'.repeat(64),pdfHash='b'.repeat(64);
// Synthetic reader contract only. The geometry collector separately checks
// these dimensions against real image bytes; these fixtures do not prove OCR.
const views=(text,second=text)=>visualBodyViewNames.map((view,i)=>{
  const value=i<2?[text,second][i]:'',dimensions={width:200,height:100};
  const region={left:.1,top:.2,width:.7,height:.1,score:.99};
  return {view,text:value,errors:0,truncated:false,lineCount:value?1:0,regions:i<2?1:0,
    positioned:{schemaVersion:1,dimensions,fields:value?[{regionIndex:0,region,text:value,confidence:.99,
      crop:(i<2?horizontalBodyCrop:verticalBodyCrop)(region,dimensions,i%2===0?.35:.65)}]:[]}};
});
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
// Counterexample found during the June 10 contrast experiment: one photo
// acquired a stable but wrong 188 reading, while its physical PDF/body was
// page 186. Synthetic fields below retain no customer content. This checks
// the adjudication boundary, not the OCR model's accuracy on the real photo.
function stableWrongSuffix({secondEngineAgrees=false,matchingBody=false}={}){
  const x=input();x.expectedPrefix='266';x.index[0].number=186;x.index[1].number=188;
  x.read.observations=[.45,.75].map(p=>row('paddle',p,'266-1-188',.99));
  x.read.independent=secondEngineAgrees?[.45,.75].map(p=>row('tesseract',p,'266-1-188',90)):[];
  x.read.readings=[...x.read.observations,...[.45,.75].map(p=>row('tesseract',p,'266-1-188',secondEngineAgrees?90:0))]
    .map(o=>({...o,errorCode:null,codeCount:o.engine==='paddle'||secondEngineAgrees?1:0,incompleteTailObserved:false}));
  x.views=views((matchingBody?other:fields).join('\n'));
  return x;
}
for(const secondEngineAgrees of [false,true]){
  const wrong=stableWrongSuffix({secondEngineAgrees}),raw=JSON.stringify(wrong);
  const result=adjudicateCodeBody(wrong);
  assert.equal(result.status,'unresolved','stable wrong suffix must not outvote actual PDF body');
  assert.equal(result.reason,'body-conflicting-body');
  assert.equal(JSON.stringify(wrong),raw,'contrary page evidence and raw observations must remain intact');
  const correct=adjudicateCodeBody(stableWrongSuffix({secondEngineAgrees,matchingBody:true}));
  assert.equal(correct.status,'resolved','the same code with its own paired page body still passes');
  assert.equal(correct.number,188);
}
const x=input(),before=JSON.stringify(x);adjudicateCodeBody(x);assert.equal(JSON.stringify(x),before,'no input or raw audit mutation');
// Three distinct short fields are not one name repeated or three fragments
// assembled from one OCR line. Synthetic text only; no customer fixtures.
const shortNames=Object.freeze(['松柏青','海月明','竹风远']);
function shortViews(names=shortNames){
  const dimensions={width:1000,height:800};
  return visualBodyViewNames.map((view,i)=>{
    const fields=i<2?names.map((text,j)=>{
      const region={left:.1+(j%2)*.5,top:.2+Math.floor(j/2)*.25,width:.12,height:.025,score:.99};
      return {text,regionIndex:j,region,confidence:.99,crop:horizontalBodyCrop(region,dimensions,i===0?.35:.65)};
    }):[];
    return {view,text:fields.map(f=>f.text).join('。'),errors:0,truncated:false,lineCount:fields.length,regions:fields.length,
      positioned:{schemaVersion:1,dimensions,fields}};
  });
}
function shortInput(){
  const value=input(),terms=[shortNames,['清风堂','白云台','明镜阁']];
  value.pages=buildVisualBodyPages(terms.map((fieldTexts,i)=>({pdfSha256:pdfHash,pageNumber:i+1,fieldTexts:[...fieldTexts]})),
    terms.map((f,i)=>({pdfSha256:pdfHash,pageNumber:i+1,views:shortViews(f)})));
  value.views=shortViews();return value;
}
const shortPositive=shortInput(),shortBefore=JSON.stringify(shortPositive);
assert.equal(adjudicateCodeBody(shortPositive).status,'resolved','three disjoint paired fields, independently extracted and visibly read from one PDF, corroborate a strong full code');
assert.equal(adjudicateCodeBody(shortPositive).policy,'observed-code-plus-three-disjoint-short-fields-v1');
assert.equal(JSON.stringify(shortPositive),shortBefore);
assert.doesNotMatch(JSON.stringify(adjudicateCodeBody(shortPositive)),/松柏青|海月明|竹风远/);
const shortReject=(label,change)=>{const value=shortInput();assert.equal(adjudicateCodeBody(value).status,'resolved',`${label}: clean independent positive baseline`);change(value);assert.notEqual(adjudicateCodeBody(value).status,'resolved',label);};
shortReject('two short fields are insufficient',x=>x.views=shortViews(shortNames.slice(0,2)));
shortReject('three repetitions are one field',x=>x.views=shortViews([shortNames[0],shortNames[0],shortNames[0]]));
shortReject('unpositioned text is insufficient',x=>x.views.forEach(v=>delete v.positioned));
shortReject('whole multiline run cannot be assembled',x=>x.views=shortViews(['松柏\n青',...shortNames.slice(1)]));
shortReject('different crops cannot pool third field',x=>{x.views[1]=shortViews([shortNames[0],shortNames[1],'青山在'])[1];});
shortReject('changed crop is not observed evidence',x=>{x.views[0].positioned.fields[0].crop.left++;});
shortReject('same detector area cannot supply three distinct fields',x=>{
  for(const v of x.views.slice(0,2))for(const f of v.positioned.fields){f.region={...v.positioned.fields[0].region};f.crop={...v.positioned.fields[0].crop};}
});
shortReject('overlapping padded crops do not prove separate fields',x=>{
  for(const [i,v] of x.views.slice(0,2).entries())for(const [j,f] of v.positioned.fields.entries()){
    f.region.left=.1+j*.12;f.region.top=.2;f.crop=horizontalBodyCrop(f.region,v.positioned.dimensions,i===0?.35:.65);
  }
});
shortReject('missing independently extracted field',x=>{x.pages[0].fieldTexts.pop();});
shortReject('missing paired visible PDF field',x=>{x.pages[0].visibleFieldViews[1].text=shortNames.slice(0,2).join('。');x.pages[0].supplementalText[1]=x.pages[0].visibleFieldViews[1].text;});
shortReject('same field inside another page blocks uniqueness',x=>{x.pages[1].fieldTexts.push('敬祝'+shortNames[0]);});
shortReject('another page with identical body remains ambiguous',x=>{x.pages[1]={...structuredClone(x.pages[0]),pageNumber:2};});
shortReject('wrong code cannot borrow these fields',x=>{x.index[0].number=18;x.index[1].number=17;});
shortReject('credible independent code conflict still vetoes',x=>{x.read.independent[0].confidence=90;x.read.readings[2].confidence=90;});
shortReject('failed view still vetoes',x=>{x.views[3].errors=1;});
console.log('Three-short-field conjunction: 1 positive and 15 rejection checks PASS');
// Regression: lengthening one independently corroborated whole field must not
// remove a valid THREE-field conjunction. Keep the two-long-field route and
// all original short-field rejection tests above unchanged.
const mixedNames=Object.freeze(['松柏清境','海月明','竹风远']);
function mixedInput(names=mixedNames){
  const value=shortInput(),terms=[names,['清风堂','白云台','明镜阁']];
  value.pages=buildVisualBodyPages(terms.map((fieldTexts,i)=>({pdfSha256:pdfHash,pageNumber:i+1,fieldTexts:[...fieldTexts]})),
    terms.map((f,i)=>({pdfSha256:pdfHash,pageNumber:i+1,views:shortViews(f)})));
  value.views=shortViews(names);return value;
}
for(const names of [mixedNames,['松柏清境晨光普照堂',...mixedNames.slice(1)]]){
  const value=mixedInput(names),before=JSON.stringify(value),result=adjudicateCodeBody(value);
  assert.equal(result.status,'resolved','one long plus two short whole fields retain the three-disjoint-field threshold');
  assert.equal(result.policy,'observed-code-plus-three-disjoint-mixed-fields-v1');
  assert.equal(result.number,17);assert.equal(result.bindingVerified,false);
  assert.equal(result.support[0].distinctFields,3);assert.equal(result.support[0].independentlyExtractedAndVisible,true);
  assert.equal(JSON.stringify(value),before);assert.doesNotMatch(JSON.stringify(result),/松柏清境|海月明|竹风远/);
}
const mixedReject=(label,change)=>{const value=mixedInput();assert.equal(adjudicateCodeBody(value).status,'resolved',`${label}: clean independent positive baseline`);change(value);assert.notEqual(adjudicateCodeBody(value).status,'resolved',label);};
mixedReject('one long plus one short is insufficient',x=>x.views=shortViews(mixedNames.slice(0,2)));
mixedReject('repeated fields do not meet three distinct fields',x=>x.views=shortViews([mixedNames[0],mixedNames[1],mixedNames[1]]));
mixedReject('unpositioned mixed text cannot authorize',x=>x.views.forEach(v=>delete v.positioned));
mixedReject('multiline long field cannot be assembled',x=>x.views=shortViews(['松柏\n清境',...mixedNames.slice(1)]));
mixedReject('long field needs its own PDF extraction, not only PDF OCR',x=>x.pages[0].fieldTexts.shift());
mixedReject('split PDF glyphs cannot become an extracted long field',x=>x.pages[0].fieldTexts.splice(0,1,...mixedNames[0]));
mixedReject('long field needs paired visible PDF support',x=>{x.pages[0].visibleFieldViews[1].text=mixedNames.slice(1).join('。');x.pages[0].supplementalText[1]=x.pages[0].visibleFieldViews[1].text;});
mixedReject('long field only in one photo view cannot be pooled',x=>{x.views[1]=shortViews(mixedNames.slice(1))[1];});
mixedReject('long field inside a longer foreign field is not unique',x=>x.pages[1].fieldTexts.push('敬祝'+mixedNames[0]));
mixedReject('short field still requires independent extraction',x=>x.pages[0].fieldTexts.pop());
mixedReject('long photo line containing a target substring is not a whole field',x=>x.views=shortViews(['敬祝'+mixedNames[0],...mixedNames.slice(1)]));
mixedReject('changed actual crop invalidates mixed proof',x=>x.views[0].positioned.fields[0].crop.left++);
mixedReject('overlapping mixed crops do not prove separate fields',x=>{
  for(const [i,v] of x.views.slice(0,2).entries())for(const [j,f] of v.positioned.fields.entries()){
    f.region.left=.1+j*.12;f.region.top=.2;f.crop=horizontalBodyCrop(f.region,v.positioned.dimensions,i===0?.35:.65);
  }
});
mixedReject('duplicate long detector occurrence cannot supply unique proof',x=>x.views=shortViews([mixedNames[0],...mixedNames]));
mixedReject('credible independent wrong code remains a veto',x=>{x.read.independent[0].confidence=90;x.read.readings[2].confidence=90;});
mixedReject('one low confidence original code crop is insufficient',x=>{x.read.observations[1].confidence=.84;x.read.readings[1].confidence=.84;});
mixedReject('wrong number cannot borrow mixed body',x=>{x.index[0].number=18;x.index[1].number=17;});
mixedReject('opposite body evidence remains a veto',x=>x.views=shortViews([...mixedNames,'清风堂']));
mixedReject('duplicate bodies remain unresolved',x=>{x.pages[1]={...structuredClone(x.pages[0]),pageNumber:2};});
mixedReject('changed original source hash remains invalid',x=>x.photoSha256='c'.repeat(64));
mixedReject('failed body view is not missing evidence',x=>x.views[3].errors=1);
console.log('Mixed whole-field conjunction: 2 positives and 21 rejection checks PASS');
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
const mixedClaimInput=mixedInput(),mixedClaim=freshItem(mixedClaimInput),mixedAudit=JSON.stringify(mixedClaim.codeAuditHistory);
assert.equal(retainCodeBodyResolution(mixedClaim,{...mixedClaimInput,pdfSetDigest:'d'.repeat(64)}).status,'resolved');
assert.equal(codeBodyResolution(mixedClaim).policy,'observed-code-plus-three-disjoint-mixed-fields-v1');
assert.equal(JSON.stringify(mixedClaim.codeAuditHistory),mixedAudit);
assert.equal(codeBodyResolution(structuredClone(mixedClaim)),null,'serialized mixed proof cannot authorize a new process');
mixedClaim.codeBodyAdjudication.support[0].fieldHashes.pop();
assert.equal(codeBodyResolution(mixedClaim),null,'altered field proof revokes the mixed authorization');
console.log('Code/body adjudication regression PASS: positive join, safety and retained-audit gates');
export {input as codeBodyTestInput,freshItem,views};
