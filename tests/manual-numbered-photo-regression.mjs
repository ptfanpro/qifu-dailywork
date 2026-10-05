import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {applyPhotoPreparation} from '../src/photo-prepare.mjs';
import {planManualNumberedPreparation,scanManualNumberedWorkday,
  ensureManualPhotoMirror,commitManualPhotoSources} from '../src/manual-photo-workflow.mjs';

const require=createRequire(import.meta.url);
const sharp=require('sharp');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
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

  const duplicate=path.join(photoDir,'352.jpg');
  fs.copyFileSync(output,duplicate);
  // Scene copies are legitimate roles, even when they have the same bytes as
  // another scene or a numbered blessing. Only distinct blessing names conflict.
  for(const name of ['2.1.jpg','2.2.jpg','2.5.jpg'])fs.copyFileSync(output,path.join(photoDir,name));
  const beforeDuplicateCheck=Object.fromEntries(fs.readdirSync(photoDir).map(name=>[name,hash(path.join(photoDir,name))]));
  const duplicateManifest=await scanManualNumberedWorkday(root,'2026-09-25');
  assert.equal(duplicateManifest.uploadReady,false);
  assert.equal(duplicateManifest.blessingReady,false);
  assert.equal(duplicateManifest.batchCompleteReady,false);
  assert.equal(duplicateManifest.normalizationReady,true,'duplicate contents must not block safe original normalization');
  assert.deepEqual(duplicateManifest.duplicateBlessingGroups,[['351.jpg','352.jpg']]);
  assert.match(duplicateManifest.blockingErrors.join('\n'),/351\.jpg、352\.jpg.*人工核对/);
  assert.equal(duplicateManifest.blockingErrors.length,1);
  assert.deepEqual(duplicateManifest.inputFileHashes,beforeDuplicateCheck);
  assert.deepEqual(Object.fromEntries(fs.readdirSync(photoDir).map(name=>[name,hash(path.join(photoDir,name))])),beforeDuplicateCheck,
    'duplicate preflight must not remove, rename or rewrite either photo');
  const oldSetHash=crypto.createHash('sha256');
  for(const name of Object.keys(beforeDuplicateCheck).sort((a,b)=>a.localeCompare(b,'zh-CN'))) {
    oldSetHash.update(`${name}\0${fs.statSync(path.join(photoDir,name)).size}\0${beforeDuplicateCheck[name]}\n`);
  }
  assert.equal(duplicateManifest.fileSetHash,oldSetHash.digest('hex'),'hash reuse must retain existing set identity');
  fs.unlinkSync(duplicate);
  const sceneCopies=await scanManualNumberedWorkday(root,'2026-09-25');
  assert.equal(sceneCopies.uploadReady,true);
  assert.deepEqual(sceneCopies.duplicateBlessingGroups,[]);
  await sharp({create:{width:1800,height:1350,channels:3,background:'#446688'}}).jpeg().toFile(duplicate);
  const distinctPhotos=await scanManualNumberedWorkday(root,'2026-09-25');
  assert.equal(distinctPhotos.uploadReady,true,'different numbered photo contents remain uploadable');
  assert.deepEqual(distinctPhotos.duplicateBlessingGroups,[]);

  const raw=path.join(photoDir,'微信图片_未编号.jpg');
  await sharp({create:{width:1800,height:1350,channels:3,background:'#fff'}}).jpeg().toFile(raw);
  const blockedPlan=await planManualNumberedPreparation({photoDir,date:'2026-09-25'});
  assert.equal(blockedPlan.safeToApply,false);
  assert.match(blockedPlan.issues.join('\n'),/微信图片_未编号\.jpg/);
  const blockedManifest=await scanManualNumberedWorkday(root,'2026-09-25');
  assert.equal(blockedManifest.uploadReady,false);
  assert.equal(blockedManifest.normalizationReady,false,'unknown names still block normalization');
  assert.match(blockedManifest.blockingErrors.join('\n'),/尚未人工编号/);

  // A duplicated pair may still be compressed in a mirror and safely saved
  // back, while the subsequent upload scan continues to require human review.
  const duplicateRoot=path.join(root,'duplicate-source');
  const duplicateDir=path.join(duplicateRoot,'9月26日','1');
  const duplicateWorkDir=path.join(root,'duplicate-state');
  fs.mkdirSync(duplicateDir,{recursive:true});
  await sharp({create:{width:3200,height:2400,channels:3,background:'#932855'}}).jpeg().toFile(path.join(duplicateDir,'411.jpg'));
  fs.copyFileSync(path.join(duplicateDir,'411.jpg'),path.join(duplicateDir,'412.jpg'));
  const uncompressed=await scanManualNumberedWorkday(duplicateRoot,'2026-09-26');
  assert.equal(uncompressed.normalizationReady,false,'size errors are not bypassed by duplicate handling');
  assert.equal(uncompressed.uploadReady,false);
  const mirror=ensureManualPhotoMirror({root:duplicateRoot,date:'2026-09-26',workDir:duplicateWorkDir});
  const duplicatePlan=await planManualNumberedPreparation({photoDir:path.join(mirror.root,'9月26日','1'),date:'2026-09-26'});
  assert.equal(duplicatePlan.safeToApply,true);
  assert.deepEqual(duplicatePlan.duplicateSources,[],'manual preparation must not discard a content duplicate');
  await applyPhotoPreparation(duplicatePlan,duplicateWorkDir);
  if(process.platform==='win32') {
    const sourceReceipt=await commitManualPhotoSources({mirror,date:'2026-09-26',workDir:duplicateWorkDir});
    assert.equal(sourceReceipt.processedCount,2);
    for(const name of ['411.jpg','412.jpg']) {
      const normalizedSource=await sharp(path.join(duplicateDir,name)).metadata();
      assert.deepEqual([normalizedSource.width,normalizedSource.height],[1800,1350]);
    }
  }
  const compressedDuplicate=await scanManualNumberedWorkday(mirror.root,'2026-09-26');
  assert.equal(compressedDuplicate.normalizationReady,true);
  assert.equal(compressedDuplicate.uploadReady,false);
  assert.deepEqual(compressedDuplicate.duplicateBlessingGroups,[['411.jpg','412.jpg']]);
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}

console.log('Manual-numbered photo workflow regression PASS: no PDF/OCR, exact normalization, duplicate blessing protection, scene exclusions and stable hashes');
