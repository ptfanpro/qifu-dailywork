import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {ensureManualPhotoMirror, planManualNumberedPreparation, scanManualNumberedWorkday} from '../src/manual-photo-workflow.mjs';
import {applyPhotoPreparation} from '../src/photo-prepare.mjs';

const require=createRequire(import.meta.url);
const sharp=require('sharp');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const base=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-manual-mirror-'));
try {
  const sourceRoot=path.join(base,'source'),sourceDir=path.join(sourceRoot,'9月28日','1');
  const workDir=path.join(base,'local-state','photos');
  fs.mkdirSync(sourceDir,{recursive:true});
  const original=path.join(sourceDir,'472.jpg');
  const noisyPixels=crypto.randomBytes(2400*1800*3);
  await sharp(noisyPixels,{raw:{width:2400,height:1800,channels:3}}).blur(3).jpeg({quality:100}).toFile(original);
  assert.ok(fs.statSync(original).size>1.5*1024*1024,'fixture must exercise oversized JPEG normalization');
  const originalHash=hash(original);
  const first=ensureManualPhotoMirror({root:sourceRoot,date:'2026-09-28',workDir});
  assert.notEqual(first.root,sourceRoot);
  assert.equal(first.sourceFileHashes['472.jpg'],originalHash);
  const mirrorDir=path.join(first.root,'9月28日','1');
  const plan=await planManualNumberedPreparation({photoDir:mirrorDir,date:'2026-09-28'});
  await applyPhotoPreparation(plan,workDir);
  assert.equal(hash(original),originalHash,'source image must remain untouched');
  const normalized=path.join(mirrorDir,'472.jpg');
  const normalizedHash=hash(normalized);
  const reused=ensureManualPhotoMirror({root:sourceRoot,date:'2026-09-28',workDir});
  assert.equal(reused.root,first.root,'unchanged source should reuse normalized local copy');
  assert.equal(hash(normalized),normalizedHash);
  const manifest=await scanManualNumberedWorkday(reused.root,'2026-09-28');
  assert.equal(manifest.uploadReady,true);
  assert.ok(manifest.fileHashes['472.jpg']);
  await sharp({create:{width:3200,height:2400,channels:3,background:'#336699'}}).jpeg().toFile(path.join(sourceDir,'473.jpg'));
  const changed=ensureManualPhotoMirror({root:sourceRoot,date:'2026-09-28',workDir});
  assert.notEqual(changed.root,first.root,'changed source must not silently reuse old snapshot');
  assert.equal(hash(original),originalHash);
} finally {
  fs.rmSync(base,{recursive:true,force:true});
}
console.log('Manual photo mirror regression PASS');
