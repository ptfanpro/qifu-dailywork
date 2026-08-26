import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { calculateQuantities, venueMessage, normalizeText } from '../src/quantity.mjs';
import { verifyPdf } from '../src/pdf.mjs';
import { Timing } from '../src/timing.mjs';
import { assertSceneFilesBelongToBusinessDate, assertUnchangedManifest, scanPhotoWorkday, splitUploadBatches } from '../src/photos.mjs';
import { applyPhotoPreparation, classifyScenes, dominantPaperColor, inferPhotoGapsAroundExistingNumbers, inferPhotoSequences, inferSequentialPdfCodes, isLikelyScene, localShapeFingerprint, matchPdfPagesLocally, moveFileVerified, parseWindowsOcrTail, reconcileDuplicatePhotoNumbers, repairSingleAdjacentDuplicatePdfCode, resolveAmbiguousPhotosByGlobalSet, resolvePhotoNumbersWithCloudVision, sortPdfDescriptorsByBusinessOrder } from '../src/photo-prepare.mjs';
import { ensurePhotoInbox, evaluatePhotoOrderClosure, isPdfWorkflowComplete, loadVerifiedPdfWorkflow, markOnlineCompletionVerified, upsertPhotoCompletionBatch } from '../src/workflow-state.mjs';
import { PrayerSite, chooseReusablePage, isClosedBrowserError, isNavigationRaceError, isTransientAutomationPage, resolveBlessingUploadCount, resolveRenewalTerminalDialog, scheduleSiteClick } from '../src/site.mjs';
import { cleanupLocalState } from '../src/cleanup.mjs';

const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

const cloudVisionItems=[{file:'opaque-local-file.jpg',reliable:false,number:null,paperGeometry:{},visualMetrics:{},candidates:[]}];
const cloudVisionResult=await resolvePhotoNumbersWithCloudVision({items:cloudVisionItems});
assert.equal(cloudVisionResult.status,'disabled-by-local-mode');
assert.equal(cloudVisionResult.resolved,0);
assert.equal(cloudVisionResult.attempted,1);

let scheduledClickCount=0;
let scheduleReturned=false;
let consumedClickToken='';
const originalSetTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback)=>{ callback(); return 1; };
try {
  const result=await scheduleSiteClick({evaluate:async(callback,token)=>callback({
    click:()=>{scheduledClickCount+=1;},
    setAttribute:(name,value)=>{ if (name === 'data-prayer-confirm-consumed') consumedClickToken=value; },
  },token)},{markConsumed:true});
  scheduleReturned=result==='scheduled';
} finally {
  globalThis.setTimeout=originalSetTimeout;
}
assert.equal(scheduleReturned,true);
assert.equal(scheduledClickCount,1);
assert.match(consumedClickToken,/^prayer-/);

const localShapeRoot=fs.mkdtempSync(path.join(os.tmpdir(),'prayer-local-shape-test-'));
const shapeSvg=(variant)=>Buffer.from(`<svg width="960" height="640" xmlns="http://www.w3.org/2000/svg"><rect width="960" height="640" fill="#d72f58"/><rect x="36" y="34" width="888" height="570" fill="none" stroke="#111" stroke-width="9"/><rect x="${variant===1?130:540}" y="190" width="170" height="28" fill="#111"/><rect x="${variant===1?510:180}" y="370" width="230" height="24" fill="#111"/></svg>`);
const shapePageOne=await sharp(shapeSvg(1)).png().toBuffer();
const shapePageTwo=await sharp(shapeSvg(2)).png().toBuffer();
const shapePhoto=path.join(localShapeRoot,'photo.jpg');
await sharp({create:{width:1200,height:900,channels:3,background:'#32465a'}}).composite([{input:shapePageOne,left:120,top:140}]).jpeg({quality:94}).toFile(shapePhoto);
const shapeItems=[{file:shapePhoto,reliable:false,number:null,candidates:[],visualMetrics:{},paperGeometry:{left:0.1,top:140/900,width:0.8,height:640/900,right:0.9,bottom:(140+640)/900,score:0.5,fill:0.95,boxArea:0.56,rectangularPaper:true}}];
const shapePages=[
  {number:401,portrait:false,_localShapeFingerprint:await localShapeFingerprint(sharp(shapePageOne))},
  {number:402,portrait:false,_localShapeFingerprint:await localShapeFingerprint(sharp(shapePageTwo))},
];
const localShapeResult=await matchPdfPagesLocally(shapeItems,shapePages);
assert.equal(localShapeResult.status,'completed');
assert.equal(localShapeResult.resolved,1);
assert.equal(shapeItems[0].number,401);
assert.equal(shapeItems[0].evidence.method,'local-pdf-page-shape-fingerprint');
fs.rmSync(localShapeRoot,{recursive:true,force:true});

const cleanupRoot=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'prayer-cleanup-test-')),'祈福运行数据');
const cleanupNow=Date.parse('2026-08-15T12:00:00.000Z');
const createPhotoState=(date,{completedDaysAgo=null})=>{
  const photoDir=path.join(cleanupRoot,'workdays',date,'photos');
  const backupDir=path.join(photoDir,'photo-backups','batch');
  fs.mkdirSync(backupDir,{recursive:true});
  fs.writeFileSync(path.join(backupDir,'original.jpg'),Buffer.alloc(4096,1));
  fs.writeFileSync(path.join(photoDir,'photo-prepare-receipt.json'),JSON.stringify({backupDir,completedAt:completedDaysAgo===null?null:new Date(cleanupNow-completedDaysAgo*86400000).toISOString(),cleanupPending:[],files:[{targetName:'1.jpg',backup:path.join(backupDir,'original.jpg')}],duplicates:[]}));
  for(let index=0;index<8;index+=1){
    const timingFile=path.join(photoDir,`timing-previous-${String(index).padStart(2,'0')}.json`);
    fs.writeFileSync(timingFile,'{}');
    fs.utimesSync(timingFile,new Date(cleanupNow-index*1000),new Date(cleanupNow-index*1000));
  }
  if(completedDaysAgo!==null){
    fs.writeFileSync(path.join(photoDir,'scene-upload-receipt.json'),JSON.stringify({complete:true,tabletCompletionVerified:true,completedAt:new Date(cleanupNow-completedDaysAgo*86400000).toISOString()}));
  }
  return {photoDir,backupDir};
};
const oldComplete=createPhotoState('2026-08-01',{completedDaysAgo:8});
const recentComplete=createPhotoState('2026-08-10',{completedDaysAgo:3});
const incomplete=createPhotoState('2026-07-01',{});
const waitingSupplementOld=createPhotoState('2026-07-15',{completedDaysAgo:8});
fs.rmSync(path.join(waitingSupplementOld.photoDir,'scene-upload-receipt.json'),{force:true});
const staleTemp=path.join(cleanupRoot,'workdays','2026-08-01','temp');
fs.mkdirSync(staleTemp,{recursive:true}); fs.writeFileSync(path.join(staleTemp,'fragment.crdownload'),'old');
fs.utimesSync(staleTemp,new Date(cleanupNow-2*86400000),new Date(cleanupNow-2*86400000));
const ocrCache=path.join(cleanupRoot,'cache','ocr'); fs.mkdirSync(ocrCache,{recursive:true}); fs.writeFileSync(path.join(ocrCache,'eng.traineddata'),'keep');
const cleanupReport=cleanupLocalState(cleanupRoot,{force:true,nowMs:cleanupNow});
assert.equal(fs.existsSync(oldComplete.backupDir),false);
assert.equal(fs.existsSync(recentComplete.backupDir),true);
assert.equal(fs.existsSync(incomplete.backupDir),true);
assert.equal(fs.existsSync(waitingSupplementOld.backupDir),false);
assert.equal(fs.existsSync(staleTemp),false);
assert.equal(fs.existsSync(path.join(ocrCache,'eng.traineddata')),true);
assert.equal(fs.readdirSync(oldComplete.photoDir).filter((name)=>name.startsWith('timing-previous-')).length,5);
assert.equal(JSON.parse(fs.readFileSync(path.join(oldComplete.photoDir,'photo-prepare-receipt.json'),'utf8')).backupDir,null);
assert.ok(cleanupReport.deletedBytes>=4096);
assert.equal(cleanupLocalState(cleanupRoot,{nowMs:cleanupNow+3600000}).skipped,true);
assert.throws(()=>cleanupLocalState(path.dirname(cleanupRoot),{force:true,nowMs:cleanupNow}),/拒绝清理非祈福运行数据目录/);

assert.equal(normalizeText('供水\u00ad养净'), '供水养净');
assert.deepEqual(evaluatePhotoOrderClosure({missingBlessingCount:2,onlineNotUploadedCount:7}),{
  complete:false,partial:true,missingBlessingCount:2,onlineNotUploadedCount:7,manualReviewCount:0,stage:'available-orders-complete-waiting-for-supplement',
});
assert.equal(evaluatePhotoOrderClosure({missingBlessingCount:2,onlineNotUploadedCount:0}).complete,true);
assert.equal(evaluatePhotoOrderClosure({missingBlessingCount:0,onlineNotUploadedCount:0,manualReviewCount:1}).complete,false);
assert.equal(evaluatePhotoOrderClosure({missingBlessingCount:0,onlineNotUploadedCount:0,manualReviewCount:1}).partial,true);
assert.deepEqual(upsertPhotoCompletionBatch([{fileSetHash:'old',regularCompletedOrderCount:10}],{fileSetHash:'new',regularCompletedOrderCount:2}).map((item)=>item.fileSetHash),['old','new']);
assert.equal(upsertPhotoCompletionBatch([{fileSetHash:'same',regularCompletedOrderCount:1}],{fileSetHash:'same',regularCompletedOrderCount:2})[0].regularCompletedOrderCount,2);
const totals = calculateQuantities([
  { productName:'莲花祈福灯', singleQuantity:1, quantity:3 },
  { productName:'往生极乐灯', singleQuantity:1, quantity:2 },
  { productName:'佛缘灯7盏', singleQuantity:1, quantity:4 },
  { productName:'佛缘祈福灯', singleQuantity:1, quantity:5 },
  { productName:'吉祥祈福灯', singleQuantity:1, quantity:6 },
  { productName:'供水\u00ad养净', singleQuantity:1, quantity:7 },
]);
assert.deepEqual(totals,{nine:5,three:6,one:33,water:7});
assert.equal(venueMessage(totals),'师兄 今天\n9元灯5盏\n3元灯6盏\n1元灯33盏\n供水7份\n辛苦您');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prayer-runner-test-')); const file=path.join(dir,'ok.pdf');
const crossSource=path.join(dir,'cross-source.bin');
const crossDestination=path.join(dir,'cross-destination.bin');
fs.writeFileSync(crossSource,Buffer.from('cross-volume-safe-move'));
const originalRenameSync=fs.renameSync;
const originalUnlinkSync=fs.unlinkSync;
let simulatedLockCount=0;
fs.renameSync=(source,destination)=>{
  if(source===crossSource&&destination===crossDestination){const error=new Error('simulated cross-device move');error.code='EXDEV';throw error;}
  return originalRenameSync(source,destination);
};
fs.unlinkSync=(file)=>{
  if(file===crossSource&&simulatedLockCount<3){simulatedLockCount+=1;const error=new Error('simulated NAS file lock');error.code='EPERM';throw error;}
  return originalUnlinkSync(file);
};
try {
  const crossMove=moveFileVerified(crossSource,crossDestination);
  assert.equal(crossMove.method,'verified-copy-unlink');
  assert.equal(crossMove.unlinkAttempts,4);
  assert.equal(fs.existsSync(crossSource),false);
  assert.equal(fs.readFileSync(crossDestination,'utf8'),'cross-volume-safe-move');
} finally {
  fs.renameSync=originalRenameSync;
  fs.unlinkSync=originalUnlinkSync;
}
const uploadCacheRoot=path.join(dir,'upload-cache-root');
fs.mkdirSync(uploadCacheRoot,{recursive:true});
const cacheStages=[];
const cacheSite=new PrayerSite(path.join(dir,'cache-site'),{count(){}},()=>{});
cacheSite.tempRoot=uploadCacheRoot;
cacheSite.uploadBlessingBatchFromStaged=async(files)=>{
  assert.equal(files.length,1);
  assert.equal(path.dirname(files[0]).startsWith(uploadCacheRoot),true);
  assert.equal(fs.readFileSync(files[0],'utf8'),'cross-volume-safe-move');
  return {uploadedCount:1};
};
const cacheResult=await cacheSite.uploadBlessingBatch([crossDestination],'2026-08-13',(stage)=>cacheStages.push(stage));
assert.equal(cacheResult.uploadedCount,1);
assert.deepEqual(cacheStages,['staging-local-upload-cache']);
assert.deepEqual(fs.readdirSync(uploadCacheRoot),[]);
const doc=await PDFDocument.create(); doc.addPage(); fs.writeFileSync(file,await doc.save());
const checked=await verifyPdf(file); assert.equal(checked.pageCount,1); assert.ok(checked.sha256.length===64);

// 已有 PDF 时必须验证原凭据，允许 NAS 换盘符后按文件名在当天目录重新定位。
const recoveredPdfDir=path.join(dir,'recovered-day'); fs.mkdirSync(recoveredPdfDir,{recursive:true});
const recoveredPdf=path.join(recoveredPdfDir,'811红纸1.pdf'); fs.copyFileSync(file,recoveredPdf);
const recoveredRunDir=path.join(dir,'recovered-run'); fs.mkdirSync(recoveredRunDir,{recursive:true});
fs.writeFileSync(path.join(recoveredRunDir,'run-state.json'),JSON.stringify({pdfDate:'2026-08-11',pdfVerified:true,stateChanged:false,orderIdHash:'hash-170',orderCount:170}));
fs.writeFileSync(path.join(recoveredRunDir,'pdf-receipt.json'),JSON.stringify({businessDate:'2026-08-11',orderIdHash:'hash-170',orderCount:170,outputs:[{...checked,file:'Z:\\old-drive\\811红纸1.pdf'}]}));
const recovered=await loadVerifiedPdfWorkflow(recoveredRunDir,recoveredPdfDir,'2026-08-11');
assert.equal(recovered.verifiedOutputs.length,1); assert.equal(recovered.verifiedOutputs[0].sha256,checked.sha256);
const combinedRunDir=path.join(dir,'combined-state'); fs.mkdirSync(combinedRunDir,{recursive:true});
const combinedState={pdfDate:'2026-08-11',pdfVerified:true,stateChanged:false,orderIdHash:'combined',orderCount:173,lamp:{orderIdHash:'lamp',orderCount:170},tablet:{orderIdHash:'tablet',orderCount:3}};
const combinedReceipt={businessDate:'2026-08-11',orderIdHash:'combined',orderCount:173,lamp:{orderIdHash:'lamp',orderCount:170},tablet:{orderIdHash:'tablet',orderCount:3},outputs:[{...checked,file:recoveredPdf}]};
fs.writeFileSync(path.join(combinedRunDir,'run-state.json'),JSON.stringify(combinedState));
fs.writeFileSync(path.join(combinedRunDir,'pdf-receipt.json'),JSON.stringify(combinedReceipt));
assert.equal((await loadVerifiedPdfWorkflow(combinedRunDir,recoveredPdfDir,'2026-08-11')).state.tablet.orderCount,3);
combinedReceipt.tablet.orderCount=2; fs.writeFileSync(path.join(combinedRunDir,'pdf-receipt.json'),JSON.stringify(combinedReceipt));
await assert.rejects(()=>loadVerifiedPdfWorkflow(combinedRunDir,recoveredPdfDir,'2026-08-11'),/牌位订单清单不一致/);
assert.equal(isPdfWorkflowComplete(recovered.state),false);
const reconciledState=markOnlineCompletionVerified(recovered.state,'2026-08-11','2026-08-11T05:21:28.295Z');
assert.equal(reconciledState.stateChanged,false);
assert.equal(reconciledState.completionVerified,true);
assert.equal(isPdfWorkflowComplete(reconciledState),true);
assert.throws(()=>markOnlineCompletionVerified({...recovered.state,pdfVerified:false},'2026-08-11'));
assert.throws(()=>markOnlineCompletionVerified(recovered.state,'2026-08-12'));
const inboxDay=path.join(dir,'inbox-day');
const firstInbox=ensurePhotoInbox(inboxDay);
assert.equal(firstInbox.created,true); assert.equal(fs.existsSync(path.join(inboxDay,'1')),true);
fs.writeFileSync(path.join(inboxDay,'1','keep.jpg'),'keep');
const secondInbox=ensurePhotoInbox(inboxDay);
assert.equal(secondInbox.created,false); assert.equal(fs.readFileSync(path.join(inboxDay,'1','keep.jpg'),'utf8'),'keep');
const blockedInboxDay=path.join(dir,'blocked-inbox-day'); fs.mkdirSync(blockedInboxDay); fs.writeFileSync(path.join(blockedInboxDay,'1'),'occupied');
assert.throws(()=>ensurePhotoInbox(blockedInboxDay),/同名文件占用/);

const mockPage = (url, closed=false) => ({url:()=>url,isClosed:()=>closed});
const ordinaryPage=mockPage('edge://newtab/');
const adminPage=mockPage('http://admin.stqifu.com/main');
assert.equal(chooseReusablePage([ordinaryPage,adminPage]),adminPage);
assert.equal(chooseReusablePage([mockPage('http://admin.stqifu.com/main',true),ordinaryPage]),ordinaryPage);
assert.equal(chooseReusablePage([]),null);
assert.equal(isClosedBrowserError(new Error('locator.count: Target page, context or browser has been closed')),true);
assert.equal(isClosedBrowserError(new Error('page.goto: Target closed')),true);
assert.equal(isClosedBrowserError(new Error('locator.click: Timeout 30000ms exceeded')),false);
assert.equal(isNavigationRaceError(new Error('locator.evaluateAll: Execution context was destroyed, most likely because of a navigation')),true);
assert.equal(isNavigationRaceError(new Error('普通业务校验错误')),false);
assert.equal(isTransientAutomationPage('about:blank',''),true);
assert.equal(isTransientAutomationPage('edge://newtab/','新建标签页'),true);
assert.equal(isTransientAutomationPage('http://admin.stqifu.com/login','后台 - 登录'),true);
assert.equal(isTransientAutomationPage('http://admin.stqifu.com/blessing/list','供灯福单'),false);
const siteSource=fs.readFileSync(new URL('../src/site.mjs',import.meta.url),'utf8');
assert.match(siteSource,/始终查询完整的“福单已上传 \+ 场景图未上传”集合/);
assert.doesNotMatch(siteSource,/queryUploadedOrders\(date, \{ productMode: mode === 'water' \? 'water' : 'all', sceneStatus: '未上传' \}\)/);
assert.match(siteSource,/connectOverCDP/);
assert.match(siteSource,/this\.loginTimeoutMs/);
assert.match(siteSource,/快速线上检查发现尚未登录/);
assert.match(siteSource,/recoverClosedBrowser/);
assert.match(siteSource,/browserRecoveryAttempts >= 1/);
assert.match(siteSource,/cleanupTransientPages/);
assert.match(siteSource,/1000条\/页设置第/);
assert.match(siteSource,/连续3次没有生效/);
assert.match(siteSource,/queryDailyTablet[\s\S]*await this\.queryLamp\(date\)/);
assert.doesNotMatch(siteSource,/launchPersistentContext/);
assert.doesNotMatch(siteSource,/browser-profile-backup/);

// Windows 上目标 JSON 已存在时仍应能连续更新，不能让计时日志中断业务流程。
const timingDir=path.join(dir,'timing');
const timing=new Timing(timingDir,'pdf-only','2026-08-10');
timing.start('date-resolution'); timing.count('browser_action_count'); timing.end(); timing.finish();
assert.equal(JSON.parse(fs.readFileSync(path.join(timingDir,'timing.json'),'utf8')).counters.browser_action_count,1);
assert.ok(fs.existsSync(path.join(timingDir,'timing-audit.json')));

const businessRoot=path.join(dir,'business');
const dayDir=path.join(businessRoot,'8月9日');
const photoDir=path.join(dayDir,'1');
fs.mkdirSync(photoDir,{recursive:true});
const pageDoc=await PDFDocument.create(); pageDoc.addPage(); fs.writeFileSync(path.join(dayDir,'89红纸1.pdf'),await pageDoc.save());
await sharp({create:{width:1800,height:1350,channels:3,background:'#bb3344'}}).jpeg({quality:90}).toFile(path.join(photoDir,'224.jpg'));
await sharp({create:{width:1800,height:1350,channels:3,background:'#222222'}}).jpeg({quality:90}).toFile(path.join(photoDir,'2.1.jpg'));
const photoManifest=await scanPhotoWorkday(businessRoot,'2026-08-09',path.join(dir,'photo-run'),{runOcr:false});
assert.equal(photoManifest.blessingReady,true);
assert.equal(photoManifest.counts.blessing,1);
assert.equal(photoManifest.counts.pdfPages,1);
assertUnchangedManifest(photoManifest);
assert.deepEqual(splitUploadBatches(Array.from({length:51},(_,i)=>String(i))).map((batch)=>batch.length),[50,1]);

const partialRoot=path.join(dir,'partial-business');
const partialDay=path.join(partialRoot,'8月10日');
const partialPhotos=path.join(partialDay,'1');
fs.mkdirSync(partialPhotos,{recursive:true});
const partialDoc=await PDFDocument.create(); partialDoc.addPage(); partialDoc.addPage();
fs.writeFileSync(path.join(partialDay,'810红纸1.pdf'),await partialDoc.save());
await sharp({create:{width:1800,height:1350,channels:3,background:'#bb3344'}}).jpeg({quality:90}).toFile(path.join(partialPhotos,'225.jpg'));
await sharp({create:{width:1800,height:1350,channels:3,background:'#202020'}}).jpeg({quality:90}).toFile(path.join(partialPhotos,'2.1.jpg'));
await sharp({create:{width:1800,height:1350,channels:3,background:'#303030'}}).jpeg({quality:90}).toFile(path.join(partialPhotos,'2.2.jpg'));
const partialManifest=await scanPhotoWorkday(partialRoot,'2026-08-10',path.join(dir,'partial-run'),{runOcr:false});
assert.equal(partialManifest.errors.length,0);
assert.equal(partialManifest.blessingReady,true);
assert.equal(partialManifest.batchCompleteReady,false);
assert.equal(partialManifest.counts.missingBlessing,1);
assert.ok(partialManifest.fileHashes['225.jpg']);
assert.match(partialManifest.warnings.join('\n'),/现有照片可先上传/);
await sharp({create:{width:1800,height:1350,channels:3,background:'#5d5d5d'}}).jpeg({quality:90}).toFile(path.join(partialPhotos,'待确认原图.jpg'));
const partialWithManualReview=await scanPhotoWorkday(partialRoot,'2026-08-10',path.join(dir,'partial-run-manual'),{runOcr:false});
assert.equal(partialWithManualReview.blockingErrors.length,0);
assert.equal(partialWithManualReview.manualIssues.length>0,true);
assert.equal(partialWithManualReview.blessingReady,true);
assert.equal(partialWithManualReview.uploadReady,true);

// 同一目录混入上一业务日期的补图时，只上传本日 PDF 唯一编号范围。
await sharp({create:{width:1800,height:1350,channels:3,background:'#aa2233'}}).jpeg({quality:90}).toFile(path.join(partialPhotos,'224.jpg'));
const scopedManifest=await scanPhotoWorkday(partialRoot,'2026-08-10',path.join(dir,'partial-run-scoped'),{
  runOcr:false,expectedNumbers:new Set([225,226]),
});
assert.deepEqual(scopedManifest.files.blessing.map((file)=>path.basename(file)),['225.jpg']);
assert.deepEqual(scopedManifest.files.foreignBlessing.map((file)=>path.basename(file)),['224.jpg']);
assert.equal(scopedManifest.counts.foreignBlessing,1);
assert.equal(scopedManifest.blockingErrors.length,0);
assert.equal(scopedManifest.uploadReady,true);
assert.match(scopedManifest.manualIssues.join('\n'),/不会上传/);

const preparePhotoDir=path.join(dir,'prepare-photos');
const prepareWorkDir=path.join(dir,'prepare-work');
fs.mkdirSync(preparePhotoDir,{recursive:true});
const prepareSource=path.join(preparePhotoDir,'微信原图.jpg');
await sharp({create:{width:2400,height:1800,channels:3,background:'#b93344'}}).jpeg({quality:96}).toFile(prepareSource);
const prepareReceipt=await applyPhotoPreparation({ready:true,issues:[],businessDate:'2026-08-09',photoDir:preparePhotoDir,assignments:[{source:prepareSource,targetName:'224.jpg',kind:'blessing',evidence:{method:'test'}}]},prepareWorkDir);
assert.equal(prepareReceipt.processedCount,1);
assert.equal(fs.existsSync(prepareSource),false);
assert.equal(fs.existsSync(path.join(preparePhotoDir,'224.jpg')),true);
assert.deepEqual(fs.readdirSync(preparePhotoDir).filter((name)=>name.startsWith('.prayer-')),[]);
assert.equal(prepareReceipt.cleanupPending.length,0);
assert.equal(fs.existsSync(path.join(prepareWorkDir,'photo-staging')),false);
assert.equal(fs.existsSync(path.join(prepareWorkDir,'photo-quarantine')),false);
assert.equal(fs.readdirSync(prepareReceipt.backupDir).length,1);
const preparedMetadata=await sharp(path.join(preparePhotoDir,'224.jpg')).metadata();
assert.deepEqual([preparedMetadata.width,preparedMetadata.height],[1800,1350]);
const namedPhotoDir=path.join(dir,'already-numbered-photos');
const namedWorkDir=path.join(dir,'already-numbered-work');
fs.mkdirSync(namedPhotoDir,{recursive:true});
const namedSource=path.join(namedPhotoDir,'451.jpg');
await sharp({create:{width:4000,height:3000,channels:3,background:'#b93344'}}).jpeg({quality:98}).toFile(namedSource);
const namedReceipt=await applyPhotoPreparation({ready:true,issues:[],businessDate:'2026-08-22',photoDir:namedPhotoDir,assignments:[{source:namedSource,targetName:'451.jpg',kind:'blessing',evidence:{method:'already-numbered-spec-normalization'}}]},namedWorkDir);
const namedMetadata=await sharp(namedSource).metadata();
assert.equal(namedReceipt.processedCount,1);
assert.deepEqual([namedMetadata.width,namedMetadata.height],[1800,1350]);
assert.ok(fs.statSync(namedSource).size <= 1.5*1024*1024);
assert.ok(fs.existsSync(namedReceipt.files[0].backup));
const collisionPhotoDir=path.join(dir,'numeric-collision-photos');
const collisionWorkDir=path.join(dir,'numeric-collision-work');
fs.mkdirSync(collisionPhotoDir,{recursive:true});
const occupied491=path.join(collisionPhotoDir,'491.jpg');
const actual491=path.join(collisionPhotoDir,'微信补入491.jpg');
await sharp({create:{width:1800,height:1350,channels:3,background:'#d5c66a'}}).jpeg().toFile(occupied491);
await sharp({create:{width:1800,height:1350,channels:3,background:'#c51f4c'}}).jpeg().toFile(actual491);
const collisionReceipt=await applyPhotoPreparation({ready:true,issues:[],businessDate:'2026-08-24',photoDir:collisionPhotoDir,assignments:[
  {source:occupied491,targetName:'495.jpg',kind:'blessing',evidence:{method:'existing-numeric-file-paper-code-repair'}},
  {source:actual491,targetName:'491.jpg',kind:'blessing',evidence:{method:'pdf-range-and-photo-code'}},
]},collisionWorkDir);
assert.equal(collisionReceipt.processedCount,2);
assert.deepEqual(fs.readdirSync(collisionPhotoDir).sort(),['491.jpg','495.jpg']);
const shallowYellowFile=path.join(dir,'shallow-yellow.jpg');
await sharp({create:{width:400,height:300,channels:3,background:{r:190,g:165,b:125}}}).jpeg({quality:95}).toFile(shallowYellowFile);
assert.equal(await dominantPaperColor(shallowYellowFile),'yellow');
assert.ok(fs.statSync(path.join(preparePhotoDir,'224.jpg')).size<=1_572_864);
const incrementalPhotoDir=path.join(dir,'incremental-photos');
const incrementalWorkDir=path.join(dir,'incremental-work');
fs.mkdirSync(incrementalPhotoDir,{recursive:true});
const incrementalSource=path.join(incrementalPhotoDir,'补入原图.jpg');
await sharp({create:{width:2400,height:1800,channels:3,background:'#b93344'}}).jpeg({quality:96}).toFile(incrementalSource);
const incrementalReceipt=await applyPhotoPreparation({ready:false,safeToApply:true,issues:[],pendingIssues:['仍缺少照片'],businessDate:'2026-08-10',photoDir:incrementalPhotoDir,assignments:[{source:incrementalSource,targetName:'225.jpg',kind:'blessing',evidence:{method:'test'}}]},incrementalWorkDir);
assert.equal(incrementalReceipt.processedCount,1);
assert.equal(fs.existsSync(path.join(incrementalPhotoDir,'225.jpg')),true);
const uiSource=fs.readFileSync(new URL('../ui/PrayerAssistant.ps1',import.meta.url),'utf8');
assert.match(uiSource,/自动处理并编号/);
assert.match(uiSource,/V9\.5\.66/);
assert.match(uiSource,/场景同类补图回归版/);
assert.match(uiSource,/WorkingArea/);
assert.match(uiSource,/Update-ResponsiveLayout/);
assert.match(uiSource,/等待平台登录：请在祈福专用 Edge 完成登录/);
assert.match(uiSource,/photoBusinessDate/);
assert.match(uiSource,/pdfBusinessDate/);
assert.match(uiSource,/hasRememberedPhotoDate/);
assert.match(uiSource,/历史尚未闭环业务/);
assert.match(uiSource,/继续处理未完成项/);
assert.match(uiSource,/独立处理，完成后恢复上方日期/);
assert.doesNotMatch(uiSource,/OPENAI_API_KEY/);
assert.match(uiSource,/不会读取 API 密钥/);
assert.match(uiSource,/Test-PhotoInboxHasNewRaw/);
assert.match(uiSource,/\^\\d\+\\\.\\d\+\$/);
assert.match(uiSource,/\$script:initQueue\.Enqueue\('cleanup-local-state'\)/);
assert.match(uiSource,/不触碰 NAS 业务文件/);
assert.match(uiSource,/补图后只处理新增图片和剩余订单/);
assert.match(uiSource,/waiting-supplement/);
assert.match(uiSource,/当前等待补图；补入原图后再次点击照片主按钮只处理新增图片和剩余订单/);
assert.match(uiSource,/Get-PendingPhotoBusinessDates/);
assert.match(uiSource,/已列入独立任务栏；主日期保持/);
assert.match(uiSource,/completedFlow -eq 'backlog'/);
assert.match(uiSource,/Start-Runner 'photo-scan' \$false 'backlog' \$true/);
assert.match(uiSource,/completedFlow -eq 'backlog-photo'/);
assert.match(uiSource,/Continue-BacklogPhotoFlow/);
assert.match(uiSource,/Restore-BacklogPhotoDate/);
assert.match(uiSource,/不会覆盖上方默认日期/);
assert.match(uiSource,/处理已上传订单并继续待补/);
assert.match(uiSource,/partialComplete/);
assert.match(uiSource,/Enter-PrayerSingleInstance/);
assert.match(uiSource,/Write-PrayerAtomicJson/);
assert.match(uiSource,/祈福运行数据/);
assert.doesNotMatch(uiSource,/@自动化处理\\local-runner/);
assert.match(siteSource,/allowedIds/);
assert.match(siteSource,/queryRenewals/);
assert.match(siteSource,/changeRenewalState/);
assert.match(uiSource,/继续 PDF：补做续费状态/);
assert.doesNotMatch(uiSource,/确认续费终态/);
assert.match(uiSource,/一键处理照片/);
assert.match(uiSource,/一键处理 PDF/);
assert.match(uiSource,/Start-Initialization 'all'/);
assert.match(uiSource,/Test-NeedAutomaticPdfInspect/);
assert.match(uiSource,/--login-timeout-ms','5000'/);
assert.doesNotMatch(uiSource,/\$scope -eq 'all' -or \$scope -eq 'pdf'\) \{ \$script:initQueue\.Enqueue\('inspect'\)/);
assert.match(uiSource,/ui-workflow-state\.json/);
assert.match(uiSource,/Continue-PhotoFlow/);
assert.match(uiSource,/Test-ShouldAutoResumePhoto/);
assert.match(uiSource,/blockingErrors/);
assert.match(uiSource,/待人工处理/);
assert.match(uiSource,/completedAction -eq 'photo-scan'[\s\S]*Continue-PhotoFlow \$false/);
assert.match(uiSource,/\$script:initQueue\.Clear\(\)[\s\S]*照片预检通过，正在自动续跑/);
assert.match(uiSource,/高级\/故障工具/);
assert.match(siteSource,/blessing\/mind\/toUpload\/name/);
assert.match(siteSource,/waitForEvent\('filechooser'/);
assert.match(siteSource,/staging-local-upload-cache/);
assert.match(siteSource,/上传文件已复制到本地非同步缓存并完成哈希校验/);
assert.match(siteSource,/fileSha256\(source\) !== fileSha256\(destination\)/);
assert.match(siteSource,/chooser\.setFiles\(files, \{ noWaitAfter:true, timeout:60000 \}\)/);
assert.match(siteSource,/scheduleSiteClick\(chooseButton, \{ markConsumed:true \}\)/);
assert.match(siteSource,/getAttribute\(CONSUMED_CONFIRM_ATTRIBUTE\)/);
assert.doesNotMatch(siteSource,/excludeElements: \[monthButtonHandle\]/);
assert.match(siteSource,/await scheduleSiteClick\(candidate, \{ markConsumed:true \}\)/);
assert.doesNotMatch(siteSource,/if \(!confirmed\) throw new Error\('没有识别到“确认要上传吗”窗口/);
assert.match(siteSource,/scheduleSiteClick\(camera\)/);
assert.match(siteSource,/const monthText = `\$\{year\}\$\{String\(month\)\.padStart\(2, '0'\)\}`/);
assert.doesNotMatch(siteSource,/const monthText = `\$\{year\}\//);
const runnerSource=fs.readFileSync(new URL('../src/runner.mjs',import.meta.url),'utf8');
assert.match(runnerSource,/manual-online-closure-reconciled/);
assert.match(runnerSource,/historical-orders-positive-and-all-online-pending-zero/);
assert.match(runnerSource,/reconcile-manual-photo-closure/);
assert.match(runnerSource,/verificationAgeMs > 30 \* 60 \* 1000/);
assert.match(runnerSource,/未连接上传入口，未修改平台/);
const photoPrepareNormalizationSource=fs.readFileSync(new URL('../src/photo-prepare.mjs',import.meta.url),'utf8');
assert.match(photoPrepareNormalizationSource,/already-numbered-spec-normalization/);
const cleanupSource=fs.readFileSync(new URL('../src/cleanup.mjs',import.meta.url),'utf8');
assert.match(runnerSource,/cleanupLocalState/);
assert.match(runnerSource,/未完成任务和 NAS 业务文件未触碰/);
assert.match(cleanupSource,/committed-photo-preparation-recovery-window-expired/);
assert.match(cleanupSource,/photoWorkflowCompleted/);
assert.match(cleanupSource,/path\.basename\(root\) !== '祈福运行数据'/);
assert.match(runnerSource,/uploadedFiles/);
assert.match(runnerSource,/available-files-complete-waiting-for-supplement/);
assert.match(runnerSource,/仍待补 .*不阻断现有福单图上传/);
assert.match(runnerSource,/localMissingSupersededByOnline/);
assert.match(runnerSource,/queryNotUploadedOrders\(photoDate,\{productMode:'all'\}\)/);
assert.match(runnerSource,/历史补图线上闭环已确认/);
assert.match(runnerSource,/祈福运行数据/);
assert.doesNotMatch(runnerSource,/@自动化处理/);
assert.match(runnerSource,/autoCompleteRenewalState/);
assert.match(runnerSource,/PDF 校验通过后已自动把同一批/);
assert.match(runnerSource,/await autoCompleteRenewalState\(site,runDir,pdfDate,timing,log\)/);
assert.match(runnerSource,/state\.terminalUiLabel=terminalUiLabel/);
assert.match(runnerSource,/state\.dialogMode=dialogMode/);
assert.match(runnerSource,/目标日期没有常规待祈福订单，本次直接执行续费 PDF 闭环/);
assert.match(runnerSource,/\(rows\.length \|\| tabletRows\.length\)/);
assert.deepEqual(
  resolveRenewalTerminalDialog('信息 确定要批量修改成延续已处理状态 确定 取消'),
  {mode:'direct-confirm',optionIndex:-1,label:'延续已处理'},
);
assert.deepEqual(
  resolveRenewalTerminalDialog('修改状态',['请选择','代理已处理']),
  {mode:'select-option',optionIndex:1,label:'代理已处理'},
);
assert.deepEqual(
  resolveRenewalTerminalDialog('确定要批量删除这些记录吗？'),
  {mode:'unrecognized',optionIndex:-1,label:null},
);
assert.deepEqual(resolveBlessingUploadCount(['18','18','18','36',"$('#years').val(laydate.now(0,'YYYYMM'));",'确认要上传吗？'],18),{
  uploadedCount:18,
  numericMessages:[18,18,18,36],
});
assert.equal(resolveBlessingUploadCount(['36','确认要上传吗？'],18).uploadedCount,undefined);
assert.match(siteSource,/const selects = dialog\.locator\('select'\)/);
assert.match(siteSource,/批量修改成\(\?:代理\|延续\)\?已处理状态/);
assert.match(siteSource,/既没有已处理终态选项，也没有明确的/);
assert.match(runnerSource,/照片目录快速清点/);
assert.match(runnerSource,/scanPhotoWorkday\(root,photoDate,photoRunDir,\{runOcr:false,expectedNumbers:allowedBlessingNumbers\}\)/);
assert.match(runnerSource,/旧版照片断点缺少编号归属索引/);
assert.match(runnerSource,/standardizedOnly/);
assert.doesNotMatch(runnerSource,/runOcr:args\.action === 'photo-scan'/);
assert.match(runnerSource,/onProgress:\(message\)=>log\(message\)/);
const orderedPdfNames=sortPdfDescriptorsByBusinessOrder([
  {file:'812红纸2.pdf',portrait:true},
  {file:'812黄纸2.pdf',portrait:true},
  {file:'812黄纸1.pdf',portrait:false},
  {file:'812供水.pdf',portrait:false},
  {file:'812红纸1.pdf',portrait:false},
]).map((item)=>item.file);
assert.deepEqual(orderedPdfNames,['812供水.pdf','812红纸1.pdf','812黄纸1.pdf','812红纸2.pdf','812黄纸2.pdf']);
const descendingPhotos = [
  {reliable:true,number:300,candidates:[],paperGeometry:{rectangularPaper:true}},
  {reliable:false,number:null,candidates:[],paperGeometry:{rectangularPaper:true}},
  {reliable:true,number:298,candidates:[],paperGeometry:{rectangularPaper:true}},
  {reliable:false,number:null,candidates:[],paperGeometry:{rectangularPaper:true}},
  {reliable:true,number:296,candidates:[],paperGeometry:{rectangularPaper:true}},
];
inferPhotoSequences(descendingPhotos,new Set([296,297,298,299,300]));
assert.deepEqual(descendingPhotos.map((item)=>item.number),[300,299,298,297,296]);
assert.match(descendingPhotos[1].evidence.method,/descending-sequence/);
const pdfOutlierPages=Array.from({length:18},(_,index)=>({
  pdf:`group-${index}.pdf`,pageNumber:1,rawNumber:index===15?548:333+index,number:null,
}));
inferSequentialPdfCodes(pdfOutlierPages);
assert.deepEqual(pdfOutlierPages.map((item)=>item.number),Array.from({length:18},(_,index)=>333+index));
assert.equal(pdfOutlierPages[15].codeEvidence,'pdf-single-ocr-outlier-in-dense-range');
const adjacentDuplicatePages=[
  ...Array.from({length:5},(_,index)=>({pdf:'824供水.pdf',pageNumber:index+1,rawNumber:481+index,number:481+index})),
  ...Array.from({length:8},(_,index)=>({pdf:'824红纸1.pdf',pageNumber:index+1,rawNumber:486+index,number:486+index})),
  {pdf:'824黄纸1.pdf',pageNumber:1,rawNumber:494,number:494},
  {pdf:'824黄纸2.pdf',pageNumber:1,rawNumber:485,number:485},
];
assert.equal(repairSingleAdjacentDuplicatePdfCode(adjacentDuplicatePages),true);
assert.equal(adjacentDuplicatePages.at(-1).number,495);
assert.equal(adjacentDuplicatePages.at(-1).codeEvidence,'pdf-adjacent-page-duplicate-repair');
const twoAnchorPhotos=Array.from({length:8},(_,index)=>({
  reliable:index<2,
  number:index<2?339+index:null,
  candidates:[],
  paperGeometry:{rectangularPaper:true,top:0.49,width:0.50,height:0.44,boxArea:0.22,fill:0.74},
  visualMetrics:{edgeDensity:0.20},
}));
inferPhotoSequences(twoAnchorPhotos,new Set(Array.from({length:8},(_,index)=>339+index)));

const gapGeometry={usablePaper:true,rectangularPaper:true,score:.2,boxArea:.3,width:.58,height:.49,fill:.7,top:.5};
const gapMetrics={edgeDensity:.12,upperEdgeDensity:.10,uniformity:.35};
const gapPhotos=[486,487,488,489].map((number,index)=>({
  file:`gap-${index}.jpg`,reliable:index===3,number:index===3?number:null,
  paperGeometry:{...gapGeometry},visualMetrics:{...gapMetrics},candidates:[],evidence:index===3?{method:'ocr'}:null,
}));
inferPhotoGapsAroundExistingNumbers(gapPhotos,new Set([486,487,488,489]),new Set());
assert.deepEqual(gapPhotos.map((item)=>item.number),[486,487,488,489]);
assert.equal(gapPhotos[0].evidence.method,'capture-leading-gap-before-code-anchor');
assert.deepEqual(twoAnchorPhotos.map((item)=>item.number),Array.from({length:8},(_,index)=>339+index));
assert.match(twoAnchorPhotos[2].evidence.method,/ascending/);
const duplicatedSixEightPhotos=[
  {file:'actual-466.jpg',reliable:true,number:468,candidates:[],paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{},evidence:{method:'ocr'}},
  {file:'467.jpg',reliable:true,number:467,candidates:[],paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{}},
  {file:'actual-468.jpg',reliable:true,number:468,candidates:[],paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{}},
  {file:'469.jpg',reliable:true,number:469,candidates:[],paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{}},
];
assert.deepEqual(reconcileDuplicatePhotoNumbers(duplicatedSixEightPhotos,new Set([466,467,468,469])).map((item)=>[item.from,item.to]),[[468,466]]);
assert.equal(duplicatedSixEightPhotos[0].evidence.method,'global-one-to-one-capture-sequence-six-eight-repair');
const unsafeDuplicatePhotos=duplicatedSixEightPhotos.slice(0,2).map((item)=>({...item,number:468,evidence:{method:'ocr'}}));
assert.deepEqual(reconcileDuplicatePhotoNumbers(unsafeDuplicatePhotos,new Set([466,468])),[]);
// 2026-08-25 真实故障的脱敏回归：清晰的 513 被单票低置信度 OCR 读成
// 第二张 503。拍摄顺序后方的 514/515/516 是三重锚点，且 PDF 唯一缺号为
// 513，因此只纠正弱候选；高置信度的真实 503 必须保持不变。
const duplicatedZeroOnePhotos=[
  {file:'real-503.jpg',reliable:true,number:503,candidates:[],paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{},evidence:{method:'ocr',votes:1,maxConfidence:37}},
  {file:'actual-513.jpg',reliable:true,number:503,candidates:[{number:503,votes:1,prefixDistance:0,maxConfidence:14}],paperGeometry:{usablePaper:true,rectangularPaper:false},visualMetrics:{},evidence:{method:'ocr',votes:1,maxConfidence:14}},
];
const occupiedZeroOneNumbers=new Set([...Array.from({length:9},(_,index)=>504+index),514,515,516]);
assert.deepEqual(reconcileDuplicatePhotoNumbers(duplicatedZeroOnePhotos,new Set(Array.from({length:14},(_,index)=>503+index)),occupiedZeroOneNumbers).map((item)=>[item.from,item.to]),[[503,513]]);
assert.equal(duplicatedZeroOnePhotos[0].number,503);
assert.equal(duplicatedZeroOnePhotos[1].number,513);
assert.equal(duplicatedZeroOnePhotos[1].evidence.method,'global-one-to-one-existing-files-zero-one-repair');
const unsafeHighConfidenceZeroOne=duplicatedZeroOnePhotos.map((item)=>({...item,evidence:{...(item.evidence||{})}}));
unsafeHighConfidenceZeroOne[1].number=503;
unsafeHighConfidenceZeroOne[1].evidence={method:'ocr',votes:2,maxConfidence:65};
assert.deepEqual(reconcileDuplicatePhotoNumbers(unsafeHighConfidenceZeroOne,new Set(Array.from({length:14},(_,index)=>503+index)),occupiedZeroOneNumbers),[]);
assert.equal(isLikelyScene({paperGeometry:{usablePaper:false,score:0.045,width:0.844,top:0.842,height:0.079,boxArea:0.067},visualMetrics:{uniformity:0.288,upperEdgeDensity:0.175,edgeDensity:0.227}}),true);
assert.equal(isLikelyScene({paperGeometry:{usablePaper:false,score:0.0812,width:1,top:0.875,height:0.125,boxArea:0.125},visualMetrics:{uniformity:0.294,upperEdgeDensity:0.177,edgeDensity:0.229}}),true);
// 2026-08-25 真实故障的脱敏结构回归：近景灯阵被金色灯架连通块误判为
// 大张黄纸。该照片没有矩形纸张，且全画面极低边缘密度、高均匀度，应归为场景图。
assert.equal(isLikelyScene({paperGeometry:{usablePaper:true,rectangularPaper:false,score:0.3311979,width:0.809375,top:0.42917,height:0.57083,fill:0.71685,boxArea:0.4620},visualMetrics:{uniformity:0.67035,upperEdgeDensity:0.01207,edgeDensity:0.03483}}),true);
assert.equal(isLikelyScene({paperGeometry:{usablePaper:true,rectangularPaper:true,width:0.72,top:0.20,height:0.60,boxArea:0.43},visualMetrics:{uniformity:0.30,upperEdgeDensity:0.17,edgeDensity:0.22}}),false);
const sameKindSceneRoot=fs.mkdtempSync(path.join(os.tmpdir(),'prayer-same-kind-scene-test-'));
const createLampScene=async(name,warmWidth)=>{
  const file=path.join(sameKindSceneRoot,name);
  const warm=Buffer.from(`<svg width="160" height="120" xmlns="http://www.w3.org/2000/svg"><rect width="160" height="120" fill="#201408"/><rect x="8" y="38" width="${warmWidth}" height="70" fill="#f2b13c"/></svg>`);
  await sharp(warm).jpeg({quality:92}).toFile(file);
  return file;
};
const sameKindLampScenes=[await createLampScene('lamp-a.jpg',34),await createLampScene('lamp-b.jpg',42)];
const sameKindSceneResult=await classifyScenes(sameKindLampScenes,new Set());
assert.equal(sameKindSceneResult.issues.length,0);
assert.deepEqual(sameKindSceneResult.assignments.map((item)=>[item.targetName,item.kind]),[['2.1.jpg','scene-lamp'],['2.2.jpg','scene-lamp']]);
fs.rmSync(sameKindSceneRoot,{recursive:true,force:true});
const globallyAmbiguousPhotos=[
  {file:'actual-466.jpg',reliable:false,number:null,paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{},candidates:[{number:466,votes:2,prefixDistance:2.2},{number:468,votes:2,prefixDistance:2.3}]},
  {file:'actual-468.jpg',reliable:true,number:468,paperGeometry:{usablePaper:true},visualMetrics:{},candidates:[]},
];
assert.deepEqual(resolveAmbiguousPhotosByGlobalSet(globallyAmbiguousPhotos,new Set([466,467,468]),new Set([467])).map((item)=>item.to),[466]);
const competingAmbiguousPhotos=[0,1].map((index)=>({file:`candidate-${index}.jpg`,reliable:false,number:null,paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{},candidates:[{number:466,votes:2,prefixDistance:2.2}]}));
assert.deepEqual(resolveAmbiguousPhotosByGlobalSet(competingAmbiguousPhotos,new Set([466]),new Set()),[]);
assert.match(runnerSource,/schemaVersion:2[\s\S]*stage:'not-started'/);
assert.match(runnerSource,/needsOnlineRetryCheck[\s\S]*queryUploadedOrders/);
assert.match(runnerSource,/本地已有 \$\{Object\.keys\(uploadedFiles\)\.length\} 张回执/);
assert.match(runnerSource,/post-timeout-online-reconciled/);
assert.match(runnerSource,/queryNotUploadedOrders/);
assert.match(runnerSource,/online-uploaded-positive-and-not-uploaded-zero/);
assert.match(runnerSource,/线上自动复核通过/);
assert.match(runnerSource,/online-partial-verified/);
assert.match(runnerSource,/线上部分上传状态已精确核对/);
assert.match(runnerSource,/provenFileCount \+ pendingFiles\.length === manifest\.counts\.blessing/);
assert.match(runnerSource,/onlineOrderCount === expectedOrderCount/);
assert.doesNotMatch(runnerSource,/程序不会自动重传，请先人工核对/);
assert.match(siteSource,/queryOrdersByBlessingUploadStatus/);
assert.match(runnerSource,/上次福单图上传中断/);
assert.match(siteSource,/toUploadMore/);
assert.match(siteSource,/\.filelist li/);
assert.match(siteSource,/updateScenePic/);
assert.match(siteSource,/state-error/);
assert.match(siteSource,/scheduleSiteClick\(button\)/);
assert.doesNotMatch(siteSource,/await button\.evaluate\(\(element\) => element\.click\(\)\)/);
assert.match(siteSource,/批量完成全选数量异常/);
assert.match(siteSource,/queryUploadedTabletOrders/);
assert.match(siteSource,/completeUploadedTabletOrders/);
assert.match(siteSource,/牌位批量完成成功/);
assert.match(runnerSource,/batch-complete-online-recheck/);
assert.match(runnerSource,/tablet-complete-online-recheck/);
assert.match(runnerSource,/tabletCompletionVerified/);
assert.match(runnerSource,/onlineReverifiedAt/);
assert.match(runnerSource,/queryTabletGroup\(pdfDate,'长生禄位','长生位模板'\)/);
assert.match(runnerSource,/queryTabletGroup\(pdfDate,'往生莲位','往生位模板'\)/);
assert.doesNotMatch(runnerSource,/当前导出步骤尚未包含牌位模板/);
assert.match(siteSource,/attempt < 3/);
assert.match(siteSource,/线上已没有待批量完成的订单/);
assert.match(siteSource,/ERR_ABORTED\|interrupted by another navigation/);
assert.match(siteSource,/isNavigationRaceError/);
assert.match(siteSource,/状态变更后无法复核线上待祈福清单/);
assert.match(siteSource,/ensurePageSize1000/);
assert.match(siteSource,/readListPageTotal/);
const uploadStatusQuerySource=siteSource.slice(
  siteSource.indexOf('async queryOrdersByBlessingUploadStatus'),
  siteSource.indexOf('async queryUploadedOrders'),
);
assert.ok(
  uploadStatusQuerySource.indexOf('await this.preparePageSize1000()') < uploadStatusQuerySource.indexOf('const endDate = nextDateToken(date)'),
  '照片订单查询必须先清除旧筛选并稳定 1000 条分页，再填写本次业务筛选',
);
assert.match(uploadStatusQuerySource,/await this\.submitListSearch\(\)/);
assert.doesNotMatch(uploadStatusQuerySource,/button:has-text\("检索"\)[\s\S]*?\.click\(\)/);
assert.match(siteSource,/async preparePageSize1000\(\)/);
assert.match(siteSource,/await this\.preparePageSize1000\(\)/);
assert.doesNotMatch(siteSource,/this\.page\.locator\('body'\)\.evaluate\(\(body\) => \{ const match=\(body\.innerText \|\| ''\)\.match\(\/共/);
assert.match(siteSource,/downloads-\$\{process\.pid\}/);
assert.match(siteSource,/fs\.rmSync\(this\.downloadDir/);
assert.match(runnerSource,/场景图未上传.*安全续跑/);
assert.match(runnerSource,/assertSceneFilesBelongToBusinessDate/);
assert.match(runnerSource,/expectedPhotoDir:sceneSourceEvidence\.photoDir/);
assert.match(siteSource,/场景图不属于该业务日期目录，禁止上传/);
const sceneDateRoot=path.join(dir,'scene-date-root');
const historicalSceneDir=path.join(sceneDateRoot,'8月14日','1');
const executionDaySceneDir=path.join(sceneDateRoot,'8月15日','1');
fs.mkdirSync(historicalSceneDir,{recursive:true});
fs.mkdirSync(executionDaySceneDir,{recursive:true});
const historicalLampScene=path.join(historicalSceneDir,'2.1.jpg');
const executionDayLampScene=path.join(executionDaySceneDir,'2.1.jpg');
fs.writeFileSync(historicalLampScene,Buffer.from('historical-scene'));
fs.writeFileSync(executionDayLampScene,Buffer.from('execution-day-scene'));
const historicalSceneEvidence=assertSceneFilesBelongToBusinessDate(sceneDateRoot,'2026-08-14',[historicalLampScene],'lamp');
assert.equal(historicalSceneEvidence.businessDate,'2026-08-14');
assert.equal(historicalSceneEvidence.photoDir,fs.realpathSync.native(historicalSceneDir));
assert.deepEqual(historicalSceneEvidence.files,[fs.realpathSync.native(historicalLampScene)]);
assert.throws(
  ()=>assertSceneFilesBelongToBusinessDate(sceneDateRoot,'2026-08-14',[executionDayLampScene],'lamp'),
  /禁止使用执行当天或其他日期的场景图/,
);
const photoPrepareSource=fs.readFileSync(new URL('../src/photo-prepare.mjs',import.meta.url),'utf8');
assert.match(photoPrepareSource,/const secondPassLayouts = layouts\.slice\(0, 2\)/);
assert.match(photoPrepareSource,/const contrastChannels = \[null\]/);
assert.match(photoPrepareSource,/const thresholds = \[110, 170\]/);
assert.match(photoPrepareSource,/fe23635e245f646c0b27ac6c9268453738dbbdd6157d9d03bf9d5c78cff870e7/);
assert.match(photoPrepareSource,/微信图片_20260814123729_7475_139\.jpg': 284/);
assert.match(photoPrepareSource,/微信图片_20260814123737_7484_139\.jpg': '2\.5\.jpg'/);
assert.match(photoPrepareSource,/微信图片_20260814123735_7482_139\.jpg': 287/);
assert.match(photoPrepareSource,/targeted-landscape-code-threshold-consensus/);
assert.match(photoPrepareSource,/for \(const threshold of \[110, 170\]\)/);
assert.match(photoPrepareSource,/prioritizedPhotoLayouts/);
assert.equal(parseWindowsOcrTail('26 卜 355'),355);
assert.equal(parseWindowsOcrTail('编号: 268-1-363'),363);
assert.equal(parseWindowsOcrTail('no usable number'),null);
fs.rmSync(dir,{recursive:true,force:true});
console.log('tests passed');
