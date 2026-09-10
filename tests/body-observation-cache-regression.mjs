import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {readBodyObservation} from '../src/body-observation-cache.mjs';
import {visualBodyViewNames} from '../src/pdf-visual-body-evidence.mjs';
import {reviewCurrentPdfBodies} from '../src/body-content-review.mjs';
import crypto from 'node:crypto';

const views=()=>visualBodyViewNames.map(view=>({view,text:'synthetic body',errors:0,truncated:false}));
test('body cache reuses observations only for identical bytes and complete reader identity',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-body-cache-'));
  try {
    let reads=0;
    const options={cacheDir:dir,source:Buffer.from('image one'),fingerprint:'a'.repeat(64),modelSha256:'b'.repeat(64),read:async()=>{reads++;return views();}};
    const first=await readBodyObservation(options);assert.equal(first.cacheHit,false);
    first.views[0].text='changed by caller';
    const second=await readBodyObservation(options);assert.equal(second.cacheHit,true);
    assert.equal(second.views[0].text,'synthetic body');assert.equal(reads,1);
    await readBodyObservation({...options,source:Buffer.from('image two')});
    await readBodyObservation({...options,fingerprint:'c'.repeat(64)});
    await readBodyObservation({...options,modelSha256:'d'.repeat(64)});
    assert.equal(reads,4);
    // A truncated or accidentally edited cache is not an apparent OCR pass.
    const entry=fs.readdirSync(dir).find(f=>f.endsWith('.json'));
    const file=path.join(dir,entry),saved=JSON.parse(fs.readFileSync(file));
    saved.views[0].text='corrupted';fs.writeFileSync(file,JSON.stringify(saved));
    const byIdentity={...options,source:Buffer.from(saved.sourceSha256===first.sourceSha256?'image one':'image two'),
      fingerprint:saved.fingerprint,modelSha256:saved.modelSha256};
    const fresh=await readBodyObservation(byIdentity);assert.equal(fresh.cacheHit,false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('incomplete, failed, missing-identity and disabled-cache reads are never cached',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-body-cache-'));
  try {
    const options={cacheDir:dir,source:Buffer.from('image'),fingerprint:'a'.repeat(64),modelSha256:'b'.repeat(64)};
    for(const make of [()=>views().slice(1),()=>{const r=views();r[0].errors=1;return r;},()=>{const r=views();r[0].truncated=true;return r;}]) {
      let calls=0;const read=async()=>{calls++;return make();};
      assert.equal((await readBodyObservation({...options,read})).cacheHit,false);
      assert.equal((await readBodyObservation({...options,read})).cacheHit,false);
      assert.equal(calls,2);
    }
    await assert.rejects(readBodyObservation({...options,read:async()=>{throw Error('reader failed');}}),/reader failed/);
    assert.equal(fs.readdirSync(dir).length,0);
    for(const change of [{fingerprint:null},{modelSha256:null},{cacheDir:null}]) {
      let calls=0;
      for(let i=0;i<2;i++)await readBodyObservation({...options,...change,read:async()=>{calls++;return views();}});
      assert.equal(calls,2);
    }
    assert.equal(fs.readdirSync(dir).length,0);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('warm OCR cache re-evaluates claims and still requires healthy models and a complete current PDF corpus',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-body-cache-guard-'));
  try {
    const file=path.join(dir,'image.jpg'),pdf=path.join(dir,'synthetic.pdf');
    fs.writeFileSync(file,'synthetic photo');fs.writeFileSync(pdf,'synthetic pdf');
    const pdfSha256=crypto.createHash('sha256').update(fs.readFileSync(pdf)).digest('hex');
    const pages=[{pdfSha256,pageNumber:1,fieldTexts:['山川日月春风秋雨'],supplementalText:[]},
      {pdfSha256,pageNumber:2,fieldTexts:['江河湖海星辰草木'],supplementalText:[]}];
    let reads=0,opens=0;
    const options={appRoot:dir,pdfFiles:[pdf],pdfPages:[{pdf,pageNumber:1,number:8},{pdf,pageNumber:2,number:6}],
      pdfIndexBinding:{digest:'b'.repeat(64),recognizerFingerprint:'a'.repeat(64),files:[{name:path.basename(pdf),sha256:pdfSha256}]},
      cacheDir:path.join(dir,'cache'),loadPages:async()=>pages,
      createReader:async()=>{opens++;return {modelSha256:'c'.repeat(64),read:async()=>{reads++;return views().map(v=>({...v,text:'山川日月春风秋雨'}));},release:async()=>{}};}};
    const first=await reviewCurrentPdfBodies({...options,claims:[{file,number:8,reliable:true}]});
    assert.equal(first.blocked,0);assert.equal(first.freshReads,1);
    const changed=await reviewCurrentPdfBodies({...options,claims:[{file,number:6,reliable:true}]});
    assert.equal(changed.blocked,1);assert.equal(changed.cacheHits,1);
    assert.equal(changed.results[0].status,'conflicting-body');
    assert.equal(reads,1);assert.equal(opens,2);
    for(const override of [{createReader:async()=>{throw Error('missing model');}},{loadPages:async()=>pages.slice(1)}]) {
      const bad=await reviewCurrentPdfBodies({...options,...override,claims:[{file,number:8,reliable:true}]});
      assert.equal(bad.blocked,1);assert.equal(bad.results[0].status,'body-reader-unavailable');
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
