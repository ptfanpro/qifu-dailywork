import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createPhotoInputBinding} from '../src/recognition-provenance.mjs';
import {applyPhotoPreparation} from '../src/photo-prepare.mjs';
import {photoFilesMatchPlan} from '../src/photo-plan-gate.mjs';

// Generated pixels only: exercise the real JPEG transaction and receipt shape,
// not a mocked receipt or any customer's photo/NAS directory.
const require=createRequire(import.meta.url),sharp=require('sharp');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-upload-receipt-test-'));
try {
  const photoDir=path.join(temp,'photos');fs.mkdirSync(photoDir);
  const source=path.join(photoDir,'raw.jpg'),scene=path.join(photoDir,'scene.jpg');
  const duplicate=path.join(photoDir,'duplicate.jpg');
  const raw=await sharp({create:{width:2000,height:1500,channels:3,background:'#d03344'}}).jpeg().toBuffer();
  const sceneBytes=await sharp({create:{width:2000,height:1500,channels:3,background:'#4466aa'}}).jpeg().toBuffer();
  fs.writeFileSync(source,raw);fs.writeFileSync(duplicate,raw);fs.writeFileSync(scene,sceneBytes);
  const plan={businessDate:'2026-01-01',createdAt:new Date().toISOString(),ready:true,issues:[],photoDir,
    photoInputBinding:createPhotoInputBinding(photoDir,[source,scene,duplicate]),
    assignments:[{source,targetName:'8.jpg',kind:'blessing'},{source:scene,targetName:'2.5.jpg',kind:'scene-water'}],
    duplicateSources:[{source:duplicate,duplicateOfNumber:8}]};
  const receipt=await applyPhotoPreparation(plan,path.join(temp,'work'));
  const currentFiles=()=>createPhotoInputBinding(photoDir,fs.readdirSync(photoDir).map(name=>path.join(photoDir,name))).files;
  assert.equal(receipt.processedCount,2);assert.equal(receipt.duplicateRemovedCount,1);
  assert.deepEqual(fs.readdirSync(photoDir).sort(),['2.5.jpg','8.jpg']);
  assert.ok(receipt.files.every(file=>file.beforeSha256!==file.afterSha256),'real resizing must change both source hashes');
  assert.equal(photoFilesMatchPlan(plan,receipt,currentFiles()),true,'actual complete transformation receipt permits resume');
  assert.equal(photoFilesMatchPlan(plan,null,currentFiles()),false,'new outputs cannot inherit raw-source approval without the receipt');
  assert.equal(photoFilesMatchPlan(plan,{...receipt,files:receipt.files.slice(0,1)},currentFiles()),false);
  const saved=fs.readFileSync(path.join(photoDir,'8.jpg'));
  fs.writeFileSync(path.join(photoDir,'8.jpg'),sceneBytes);
  assert.equal(photoFilesMatchPlan(plan,receipt,currentFiles()),false,'same-name replacement after processing invalidates the receipt');
  fs.writeFileSync(path.join(photoDir,'8.jpg'),saved);
  fs.writeFileSync(path.join(photoDir,'later-raw.jpg'),raw);
  assert.equal(photoFilesMatchPlan(plan,receipt,currentFiles()),true,'unassigned raw supplement does not invalidate unchanged approved outputs');
  console.log('Real JPEG preparation / exact upload receipt integration PASS');
} finally {
  const actual=fs.realpathSync(temp),parent=fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(actual).toLowerCase(),parent.toLowerCase());
  assert.ok(path.basename(actual).startsWith('qifu-upload-receipt-test-'));
  fs.rmSync(actual,{recursive:true,force:true});
}
