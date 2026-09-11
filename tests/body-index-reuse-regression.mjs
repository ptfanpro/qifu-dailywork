import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as review from '../src/body-content-review.mjs';
import {visualBodyViewNames,buildVisualBodyPages} from '../src/pdf-visual-body-evidence.mjs';
const views=(text,second=text)=>visualBodyViewNames.map((view,i)=>({view,text:i===1?second:text,errors:0,truncated:false}));
const makePages=()=>buildVisualBodyPages([
  {pdfSha256:'a'.repeat(64),pageNumber:1,fieldTexts:['山川日月春风秋雨','共同模板固定文案']},
  {pdfSha256:'a'.repeat(64),pageNumber:2,fieldTexts:['江河湖海星辰草木','共同模板固定文案']},
],[1,2].map(pageNumber=>({pdfSha256:'a'.repeat(64),pageNumber,
  views:views(pageNumber===1?'山川日月春风秋雨':'江河湖海星辰草木')})));

test('one batch body index gives identical full results for every view and claim',()=>{
  const pages=makePages(),assess=review.createBodyClaimAssessor(pages);
  for(const claim of pages)for(const observation of [views('山川日月春风秋雨'),views('江河湖海星辰草木'),
    views('山川日月春风秋雨。江河湖海星辰草木'),views('共同模板固定文案'),views('江河湖海星辰草木',''),views('')]){
    assert.deepEqual(assess(observation,claim),review.assessBodyClaim(observation,pages,claim));
  }
});

test('body index owns its snapshot and cannot leak a prior page set or mutable result',()=>{
  const pages=makePages(),original=structuredClone(pages),assess=review.createBodyClaimAssessor(pages);
  const observed=views('江河湖海星辰草木'),claim={pdfSha256:pages[0].pdfSha256,pageNumber:1};
  const first=assess(observed,claim),expected=structuredClone(first);
  assert.equal(first.status,'conflicting-body');
  first.results[0].ranked[0].uniqueMatchedGrams=9000;first.fieldEvidence.readings[0].ranked.length=0;
  pages[1].fieldTexts.length=0;pages[1].supplementalText.fill('');pages[1].visibleFieldViews.forEach(v=>v.text='');pages[1].pageNumber=7;
  assert.deepEqual(assess(observed,claim),expected);
  assert.throws(()=>assess(observed,pages[1]),/identity/i);
  const next=review.createBodyClaimAssessor(pages);
  assert.notDeepEqual(next(observed,claim),expected,'new corpus must have a separate index');
  assert.deepEqual(review.assessBodyClaim(observed,original,claim),expected);
});

test('prepared body index still rejects source/view corruption and checks each claim',()=>{
  for(const mutate of [p=>p.push(p[0]),p=>p[0].visibleFieldViews[1].errors=1,
    p=>p[0].visibleFieldViews[1].text='changed',p=>p[0].visibleFieldViews.pop()]){
    const pages=makePages();mutate(pages);assert.throws(()=>review.createBodyClaimAssessor(pages));
  }
  const pages=makePages(),assess=review.createBodyClaimAssessor(pages),broken=views('');broken[0].errors=1;
  assert.equal(assess(broken,pages[0]).status,'body-reader-unavailable');
  assert.throws(()=>assess(views('').slice(1),pages[0]),/views/);
  assert.throws(()=>assess(views(''),{pdfSha256:'b'.repeat(64),pageNumber:1}),/identity/);
});

test('querying a prepared corpus never hashes the PDF template text again',()=>{
  const original=crypto.createHash;let count=0;
  crypto.createHash=(...args)=>{count++;return original(...args);};
  try {
    const pages=makePages(),assess=review.createBodyClaimAssessor(pages);assert(count>0);
    count=0;const one=assess(views(''),pages[0]),firstQuery=count;
    count=0;const two=assess(views(''),pages[0]);assert.deepEqual(two,one);assert.equal(count,firstQuery);
    // Empty observations still hash two evidence digests per page/view and
    // one short-field digest. No page n-grams are rebuilt for any query.
    assert.equal(firstQuery,pages.length*visualBodyViewNames.length*3);
  } finally {crypto.createHash=original;}
});

function collectorFixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-body-index-test-'));
  const pdf=path.join(root,'synthetic.pdf');fs.writeFileSync(pdf,'synthetic PDF');
  const pdfSha256=crypto.createHash('sha256').update(fs.readFileSync(pdf)).digest('hex');
  const files=Array.from({length:3},(_,i)=>{const f=path.join(root,'photo-'+i+'.jpg');fs.writeFileSync(f,'synthetic photo '+i);return f;});
  return {root,pdf,files,pages:makePages().map(p=>({...p,pdfSha256})),
    options:{appRoot:root,pdfFiles:[pdf],pdfPages:[1,2].map(pageNumber=>({pdf,pageNumber,number:pageNumber})),
      pdfIndexBinding:{digest:'b'.repeat(64),files:[{name:path.basename(pdf),sha256:pdfSha256}]},
      createReader:async()=>({read:async()=>views('山川日月春风秋雨'),release:async()=>{}})}};
}

test('actual collector builds its current PDF index once for one or several photos',async()=>{
  const f=collectorFixture();
  try {
    let fieldReads=0;
    for(const p of f.pages){const fields=p.fieldTexts;Object.defineProperty(p,'fieldTexts',{get(){fieldReads++;return fields;},enumerable:true});}
    const run=n=>review.reviewCurrentPdfBodies({...f.options,loadPages:async()=>f.pages,
      claims:f.files.slice(0,n).map(file=>({file,number:1,reliable:true}))});
    const one=await run(1),oneReads=fieldReads;assert(oneReads>0);fieldReads=0;
    const three=await run(3);assert.equal(three.attempted,3);assert.equal(three.blocked,0);
    assert.equal(fieldReads,oneReads,'PDF index construction must not scale with photo count');
    assert(three.results.every(r=>r.status===one.results[0].status));
  } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});

test('source change after preparing the batch index invalidates every apparent pass',async()=>{
  const f=collectorFixture();
  try {
    let reads=0;const claims=f.files.map(file=>({file,number:1,reliable:true}));
    const result=await review.reviewCurrentPdfBodies({...f.options,loadPages:async()=>f.pages,claims,
      createReader:async()=>({read:async()=>{if(++reads===3)fs.writeFileSync(f.pdf,'changed PDF');return views('山川日月春风秋雨');},release:async()=>{}})});
    assert.equal(reads,3);assert.equal(result.blocked,3);
    assert(result.results.every(r=>r.status==='body-reader-unavailable'));
    assert(claims.every(p=>!p.reliable&&p.number===null));
  } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});
