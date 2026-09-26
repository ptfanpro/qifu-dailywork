import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {applyPhotoPreparation} from '../src/photo-prepare.mjs';
import {planManualNumberedPreparation,scanManualNumberedWorkday} from '../src/manual-photo-workflow.mjs';

const require=createRequire(import.meta.url);
const sharp=require('sharp');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-manual-numbered-'));
try {
  const day=path.join(root,'9月25日'),photoDir=path.join(day,'1'),workDir=path.join(root,'state');
  fs.mkdirSync(photoDir,{recursive:true});
  const source=path.join(photoDir,'351.png');
  await sharp({create:{width:3200,height:2400,channels:3,background:'#8c2436'}}).png().toFile(source);

  const plan=await planManualNumberedPreparation({photoDir,date:'2026-09-25'});
  assert.equal(plan.manualNumberedMode,true);
  assert.equal(plan.safeToApply,true);
  assert.equal(plan.pdfIndexBinding,undefined,'manual mode must not bind or read a PDF');
  assert.deepEqual(plan.allowedBlessingNumbers,[351]);
  assert.deepEqual(plan.assignments.map(item=>item.targetName),['351.jpg']);
  const receipt=await applyPhotoPreparation(plan,workDir);
  assert.equal(receipt.blessingCount,1);
  assert.equal(fs.existsSync(path.join(photoDir,'351.png')),false);
  const output=path.join(photoDir,'351.jpg'),metadata=await sharp(output).metadata();
  assert.deepEqual([metadata.width,metadata.height],[1800,1350]);
  assert.ok(fs.statSync(output).size<=1.5*1024*1024);

  const manifest=await scanManualNumberedWorkday(root,'2026-09-25');
  assert.equal(manifest.manualNumberedMode,true);
  assert.equal(manifest.counts.blessing,1);
  assert.equal(manifest.counts.pdf,0);
  assert.equal(manifest.counts.pdfPages,0);
  assert.deepEqual(manifest.pdfs,[]);
  assert.equal(manifest.uploadReady,true);
  assert.equal(manifest.blockingErrors.length,0);

  const raw=path.join(photoDir,'微信图片_未编号.jpg');
  await sharp({create:{width:1800,height:1350,channels:3,background:'#fff'}}).jpeg().toFile(raw);
  const blockedPlan=await planManualNumberedPreparation({photoDir,date:'2026-09-25'});
  assert.equal(blockedPlan.safeToApply,false);
  assert.match(blockedPlan.issues.join('\n'),/微信图片_未编号\.jpg/);
  const blockedManifest=await scanManualNumberedWorkday(root,'2026-09-25');
  assert.equal(blockedManifest.uploadReady,false);
  assert.match(blockedManifest.blockingErrors.join('\n'),/尚未人工编号/);
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}

console.log('Manual-numbered photo workflow regression PASS: no PDF/OCR dependency, exact normalization and upload manifest');
