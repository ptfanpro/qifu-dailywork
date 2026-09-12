import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {input} from './experiments/whole-body-conjunction-regression.mjs';
import {blankBodyItem} from './body-only-collector-regression.mjs';
import {reviewCurrentPdfBodies} from '../src/body-content-review.mjs';
import {wholeBodyResolution} from '../src/whole-body-adjudication.mjs';
import {applyPhotoPreparation,recheckReliablePhotoClaimsWithPdf} from '../src/photo-prepare.mjs';
import {createPhotoInputBinding,createPdfIndexBinding,canReusePdfIndex} from '../src/recognition-provenance.mjs';
import {photoFilesMatchPlan,assertWritePlanReady} from '../src/photo-plan-gate.mjs';

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const date='2026-03-04',fingerprint='synthetic-restart-regression';
if(process.argv[2]==='--restart-child') {
  // A real separate process: no in-memory authorization can be inherited.
  const root=process.argv[3],expected=process.argv[4]==='pass';
  const plan=JSON.parse(fs.readFileSync(path.join(root,'plan.json')));
  const receiptFile=path.join(root,'receipt.json');
  const receipt=fs.existsSync(receiptFile)?JSON.parse(fs.readFileSync(receiptFile)):null;
  assert.equal(wholeBodyResolution(plan.recognized[0]),null);
  const recheck=await recheckReliablePhotoClaimsWithPdf(JSON.parse(JSON.stringify(plan.recognized)),plan.pdfPages);
  assert.equal(recheck.confirmed,0,'serialized evidence cannot mint new recognition authority');
  assertWritePlanReady(plan,{imageCount:1,action:'photo-upload'});
  const inputs=createPhotoInputBinding(plan.photoDir,fs.readdirSync(plan.photoDir).map(n=>path.join(plan.photoDir,n)));
  const binding=createPdfIndexBinding(date,[path.join(root,'synthetic.pdf')],fingerprint);
  assert.equal(canReusePdfIndex(plan,binding)&&photoFilesMatchPlan(plan,receipt,inputs.files),expected);
} else {
  const require=createRequire(import.meta.url),sharp=require('sharp');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-body-only-restart-test-'));
  try {
    const pdf=path.join(root,'synthetic.pdf'),photoDir=path.join(root,'photos');fs.mkdirSync(photoDir);
    const file=path.join(photoDir,'raw.jpg');
    // Generated pixels and mocked OCR fields only. This tests the real JPEG
    // transaction/restart gates, NOT actual model accuracy or online uploads.
    fs.writeFileSync(pdf,'synthetic two-page identity');
    fs.writeFileSync(file,await sharp({create:{width:1000,height:800,channels:3,background:'#d03344'}}).jpeg().toBuffer());
    const data=input(),item=blankBodyItem(file,sha(fs.readFileSync(file)));
    const binding=createPdfIndexBinding(date,[pdf],fingerprint);
    data.pages.forEach(p=>p.pdfSha256=binding.files[0].sha256);
    const pdfPages=[1,2].map((pageNumber,i)=>({pdf,pageNumber,number:7+i,_localShapeFingerprint:[1]}));
    const review=await reviewCurrentPdfBodies({appRoot:root,pdfFiles:[pdf],pdfPages,pdfIndexBinding:binding,claims:[],unresolvedClaims:[item],
      loadPages:async()=>data.pages,createReader:async()=>({read:async()=>data.views,release:async()=>{}})});
    assert.equal(review.adjudicated.length,1);
    assert.equal((await recheckReliablePhotoClaimsWithPdf([item],pdfPages)).confirmed,1);
    const plan={businessDate:date,createdAt:new Date().toISOString(),folder:root,photoDir,
      safeToApply:true,ready:false,issues:[],pdfIndexBinding:binding,pdfPages,
      photoInputBinding:createPhotoInputBinding(photoDir,[file]),photoReviewExclusions:{schemaVersion:1,files:[]},
      bodyClaimReview:{status:review.status},allowedBlessingNumbers:[7,8],recognized:[item],duplicateSources:[],
      assignments:[{source:file,targetName:'7.jpg',kind:'blessing',evidence:item.evidence}]};
    const receipt=await applyPhotoPreparation(plan,path.join(root,'work'));
    assert.equal(receipt.processedCount,1);assert.notEqual(receipt.files[0].beforeSha256,receipt.files[0].afterSha256);
    const planFile=path.join(root,'plan.json'),receiptFile=path.join(root,'receipt.json');
    fs.writeFileSync(planFile,JSON.stringify(plan));fs.writeFileSync(receiptFile,JSON.stringify(receipt));
    const restart=expected=>{
      const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--restart-child',root,expected],
        {encoding:'utf8',windowsHide:true,timeout:30000});
      assert.equal(child.status,0,`${expected}: ${child.stderr}`);
    };
    restart('pass');
    fs.renameSync(receiptFile,receiptFile+'.saved');restart('reject');fs.renameSync(receiptFile+'.saved',receiptFile);
    const output=path.join(photoDir,'7.jpg'),saved=fs.readFileSync(output);
    fs.writeFileSync(output,'same-name replacement');restart('reject');fs.writeFileSync(output,saved);
    fs.writeFileSync(pdf,'different PDF after restart');restart('reject');
    console.log('Blank-code/body real JPEG and separate-process restart PASS: valid receipt resumes; serialized identity, missing receipt and source replacements rejected');
  } finally {
    const actual=fs.realpathSync(root),parent=fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(actual).toLowerCase(),parent.toLowerCase());
    assert.ok(path.basename(actual).startsWith('qifu-body-only-restart-test-'));
    fs.rmSync(actual,{recursive:true,force:true});
  }
}
