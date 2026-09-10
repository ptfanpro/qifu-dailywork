import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {isLikelyScene,photoCodeAuditBlockReason,recheckReliablePhotoClaimsWithPdf,applyPhotoPreparation} from '../src/photo-prepare.mjs';
import {createPhotoReviewExclusions,reviewExcludedPhotoNames,assertPhotoReviewIsolation,pdfReviewBlockReason} from '../src/photo-review-isolation.mjs';
import {createPhotoInputBinding} from '../src/recognition-provenance.mjs';
import {scanPhotoWorkday} from '../src/photos.mjs';
import {assertWritePlanReady,photoFilesMatchPlan} from '../src/photo-plan-gate.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp'),{PDFDocument}=require('pdf-lib');

// Synthetic evidence only. These tests exercise the real review-to-scene
// transition; a vetoed proposal must not acquire another upload role.
const sceneShapedClaim=()=>({file:'synthetic.jpg',reliable:true,number:8,candidates:[],
  evidence:{method:'targeted-landscape-code-threshold-consensus',votes:2,maxConfidence:90},
  paperGeometry:{usablePaper:false,rectangularPaper:false,width:.3,height:.3,boxArea:.09},
  visualMetrics:{edgeDensity:.08,upperEdgeDensity:.06,uniformity:.6},
  sceneMetrics:{luminance:60,darkRatio:.7,warmBrightRatio:.08,flameStructure:{distributed:true}}});

test('rejected PDF claim remains excluded from scene and later proposal paths',async()=>{
  const item=sceneShapedClaim();
  assert.equal(isLikelyScene(item),false);
  const result=await recheckReliablePhotoClaimsWithPdf([item],[]);
  assert.equal(result.rejected,1);
  assert.equal(item.pdfRecheck.reason,'claimed-pdf-page-not-unique');
  assert.equal(isLikelyScene(item),false,'failed paper review must not turn into a lamp');
  assert.ok(photoCodeAuditBlockReason(item));
  // Later proposal bookkeeping must not erase the earlier review.
  item.reliable=true;item.number=9;item.pdfRecheck={status:'confirmed'};
  item.evidence={method:'scene-visual-fast-path'};
  assert.ok(photoCodeAuditBlockReason(item),'immutable review history must survive a rewritten proposal');
  assert.equal(isLikelyScene(item),false);
});

test('an unreadable existing filename is not a confirmed numeric photo',async()=>{
  const item={file:'8.jpg',number:8,reliable:true,candidates:[],
    evidence:{method:'existing-numeric-filename-claim'},observedOcrNumber:null};
  const result=await recheckReliablePhotoClaimsWithPdf([item],[{number:8,_localShapeFingerprint:[1]}]);
  assert.equal(result.inconclusive,1);assert.equal(result.confirmed,0);
  assert.equal(item.reliable,false,'inconclusive is not eligible for normalization/upload');
  assert.ok(photoCodeAuditBlockReason(item));
});

test('failed, missing and malformed reviews cannot be replaced by success labels',()=>{
  for(const status of ['rejected','inconclusive','unavailable'])assert.ok(pdfReviewBlockReason({pdfClaimReviewHistory:[{status,reason:'review-failed'}],pdfRecheck:{status:'confirmed'}}));
  for(const history of [null,{},[],[null],[{status:'invented'}]])assert.ok(pdfReviewBlockReason({pdfClaimReviewHistory:history}));
  assert.equal(pdfReviewBlockReason({pdfClaimReviewHistory:[{status:'confirmed'}]}),null);
  assert.equal(pdfReviewBlockReason({}),null);
});

test('exclusions require exact input identity and forbid every processing role',()=>{
  const photoDir=path.resolve('synthetic'),file=path.join(photoDir,'8.jpg'),sha256='a'.repeat(64);
  const input={schemaVersion:1,files:[{name:'8.jpg',sha256}]};
  const item={file,pdfRecheck:{status:'rejected',reason:'claimed-pdf-page-not-unique'}};
  const photoReviewExclusions=createPhotoReviewExclusions([item,item],input,photoCodeAuditBlockReason);
  assert.equal(photoReviewExclusions.files.length,1);
  const plan={photoDir,photoInputBinding:input,photoReviewExclusions,allowedBlessingNumbers:[9],assignments:[],duplicateSources:[],
    safeToApply:true,issues:[],bodyClaimReview:{status:'not-needed'}};
  assertPhotoReviewIsolation(plan);
  assertWritePlanReady(plan,{imageCount:1,action:'photo-upload'});
  for(const kind of ['blessing','scene-lamp','scene-water'])assert.throws(()=>assertPhotoReviewIsolation({...plan,assignments:[{source:file,targetName:kind==='blessing'?'9.jpg':'2.1.jpg',kind}]}),/待复核照片/);
  assert.throws(()=>assertPhotoReviewIsolation({...plan,duplicateSources:[{source:file,duplicateOfNumber:9}]}),/待复核照片/);
  assert.throws(()=>assertPhotoReviewIsolation({...plan,assignments:[{source:path.join(photoDir,'good.jpg'),targetName:'8.jpg',kind:'blessing'}]}),/待复核照片/);
  assert.throws(()=>assertPhotoReviewIsolation({...plan,allowedBlessingNumbers:[8,9]}),/允许上传编号/);
  assert.throws(()=>assertWritePlanReady({...plan,allowedBlessingNumbers:[8]},{imageCount:1,action:'photo-scenes'}),/允许上传编号/);
  for(const scope of [null,{schemaVersion:1,files:[{name:'../8.jpg',sha256,reason:'bad'}]},
    {schemaVersion:1,files:[{name:'8.jpg',sha256:'b'.repeat(64),reason:'bad'}]},
    {schemaVersion:1,files:[...photoReviewExclusions.files,...photoReviewExclusions.files]}])
    assert.throws(()=>reviewExcludedPhotoNames({...plan,photoReviewExclusions:scope}),/凭据/);
});

test('real JPEG partial processing leaves excluded numeric/raw/scene bytes untouched on resume',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-review-isolation-test-'));
  try {
    const date='2026-01-01',folder=path.join(temp,'1月1日'),photoDir=path.join(folder,'1'),work=path.join(temp,'work');
    fs.mkdirSync(photoDir,{recursive:true});
    const raw=await sharp({create:{width:2000,height:1500,channels:3,background:'#d03344'}}).jpeg().toBuffer();
    const names=['8.jpg','unresolved.jpg','2.5.jpg','good.jpg'];
    for(const name of names)fs.writeFileSync(path.join(photoDir,name),raw);
    const pdf=await PDFDocument.create();pdf.addPage([200,150]);pdf.addPage([200,150]);
    fs.writeFileSync(path.join(folder,'synthetic.pdf'),await pdf.save());
    const inputs=createPhotoInputBinding(photoDir,names.map(name=>path.join(photoDir,name)));
    const blocked=names.slice(0,3).map(name=>({file:path.join(photoDir,name),pdfRecheck:{status:'rejected',reason:'synthetic-review-conflict'}}));
    const scope=createPhotoReviewExclusions(blocked,inputs,photoCodeAuditBlockReason);
    const plan={businessDate:date,createdAt:new Date().toISOString(),photoDir,photoInputBinding:inputs,
      photoReviewExclusions:scope,allowedBlessingNumbers:[9],safeToApply:true,ready:false,issues:[],
      assignments:[{source:path.join(photoDir,'good.jpg'),targetName:'9.jpg',kind:'blessing'}],duplicateSources:[],bodyClaimReview:{status:'not-needed'}};
    const receipt=await applyPhotoPreparation(plan,work);
    assert.equal(receipt.processedCount,1);
    for(const name of names.slice(0,3))assert.deepEqual(fs.readFileSync(path.join(photoDir,name)),raw,'exclusion must not rewrite or quarantine the original');
    assert.equal(fs.existsSync(path.join(photoDir,'good.jpg')),false);
    const current=createPhotoInputBinding(photoDir,fs.readdirSync(photoDir).map(name=>path.join(photoDir,name))).files;
    assert.equal(photoFilesMatchPlan(plan,receipt,current),true);
    assertWritePlanReady(plan,{imageCount:4,action:'photo-upload'});
    const manifest=await scanPhotoWorkday(temp,date,work,{runOcr:false,expectedNumbers:new Set(plan.allowedBlessingNumbers),
      expectedNumberModes:new Map([[9,'tablet']]),excludedPhotoNames:reviewExcludedPhotoNames(plan)});
    assert.deepEqual(manifest.files.blessing.map(file=>path.basename(file)),['9.jpg']);
    assert.equal(manifest.counts.reviewExcluded,3);assert.equal(manifest.counts.waterScene,0);
    assert.equal(manifest.photoAvailability.unclassifiedPhotos,3);
    assert.deepEqual(manifest.blockingErrors,[],'an unrelated verified photo can continue');
    assert.deepEqual(Object.keys(manifest.fileHashes),['9.jpg']);
    // A late resolver or damaged cached plan cannot re-add an excluded item.
    await assert.rejects(applyPhotoPreparation({...plan,assignments:[{source:path.join(photoDir,'8.jpg'),targetName:'8.jpg',kind:'blessing'}]},work),/待复核照片/);
    for(const name of names.slice(0,3))assert.deepEqual(fs.readFileSync(path.join(photoDir,name)),raw);
  } finally {
    const resolved=fs.realpathSync(temp),parent=fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved).toLowerCase(),parent.toLowerCase());
    assert.ok(path.basename(resolved).startsWith('qifu-review-isolation-test-'));
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});

test('production planner/scan/commit use the exclusion boundary, while global exceptions stay fatal',()=>{
  const source=fs.readFileSync(new URL('../src/photo-prepare.mjs',import.meta.url),'utf8');
  assert.match(source,/pendingIssues\.push\(`编号二次复核未通过/);
  assert.doesNotMatch(source,/issues\.push\(`编号二次复核未通过/);
  assert.match(source,/issues\.push\('编号二次复核发生异常/);
  assert.match(source,/if \(isReviewExcluded\(file\)\) continue/);
  assert.match(source,/&& !isReviewExcluded\(item\.file\)/);
  assert.match(source,/!reviewExcludedNumbers\.has\(number\)/);
  const runner=fs.readFileSync(new URL('../src/runner.mjs',import.meta.url),'utf8');
  assert.match(runner,/excludedPhotoNames=reviewExcludedPhotoNames\(cachedPhotoPlan\)/);
  assert.match(runner,/expectedNumberModes,excludedPhotoNames/);
});
