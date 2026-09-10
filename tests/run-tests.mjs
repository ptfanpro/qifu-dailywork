import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { calculateQuantities, venueMessage, normalizeText } from '../src/quantity.mjs';
import { verifyPdf } from '../src/pdf.mjs';
import { Timing } from '../src/timing.mjs';
import { assertSceneFilesBelongToBusinessDate, assertUnchangedManifest, scanPhotoWorkday, splitUploadBatches } from '../src/photos.mjs';
import { applyPhotoPreparation, classifyScenes, classifySceneVisualScore, dominantPaperColor, hasAdjacentLocalOcrConsensus, hasDirectVisibleCodeEvidence, hasStrongOcrConflict, inferPhotoGapsAroundExistingNumbers, inferPhotoSequences, inferSequentialPdfCodes, inferTrailingUnreadPdfCodes, isContinuousPhotoCapture, isLikelyScene, isReliableOcrConsensus, localOcrCodeLayoutsForPhoto, localShapeFingerprint, matchPdfPagesLocally, moveFileVerified, OVERLAPPING_RIGHT_CODE_BANDS, parseLocalOcrCodeCandidates, parseLooseWindowsCodeCandidates, parseWindowsOcrTail, photoCaptureTimestamp, prioritizedPhotoLayouts, reconcileDuplicatePhotoNumbers, reconcileDuplicatePhotoNumbersByPdfStructure, recheckReliablePhotoClaimsWithPdf, repairSingleAdjacentDuplicatePdfCode, resolveAmbiguousPhotosByGlobalSet, resolvePhotoNumbersWithCloudVision, sortPdfDescriptorsByBusinessOrder, targetedCurrentCodeLayouts } from '../src/photo-prepare.mjs';
import { ensurePhotoInbox, evaluatePhotoOnlineRecheck, evaluatePhotoOrderClosure, isPdfWorkflowComplete, loadVerifiedPdfWorkflow, markOnlineCompletionVerified, resolveHistoricalPhotoClosureEvidence, resolvePdfBoundPhotoOrderScope, upsertPhotoCompletionBatch } from '../src/workflow-state.mjs';
import { CAPTCHA_INPUT_SELECTOR, SCENE_UPLOAD_FRAME_TIMEOUT_MS, PrayerSite, chooseReusablePage, isBlessingUploadTransport, isCaptchaInputDescriptor, isClosedBrowserError, isNavigationRaceError, isSceneUploadFrameUrl, isTransientAutomationPage, resolveBlessingOrderSetUploadState, resolveBlessingUploadCount, resolveBlessingUploadResponseCount, resolveRenewalTerminalDialog, scheduleSiteClick, waitForSceneUploadFrame, watchBlessingUploadTransport } from '../src/site.mjs';
import { cleanupLocalState } from '../src/cleanup.mjs';
import { AutomationApiClient, canonicalTokenRequest, createTokenRequest, normalizeAutomationBaseUrl } from '../src/automation-auth.mjs';
import { decodePaddleCtc, recognizeLocalTextLine, verifyLocalOcrAssets } from '../src/local-ocr.mjs';
import {createPhotoInputBinding} from '../src/recognition-provenance.mjs';
import {runPhotoPdfCommitRegression} from './photo-pdf-commit-regression.mjs';
import {runSceneCategoryCapacityRegression} from './scene-category-capacity-regression.mjs';
import './weekend-regression.mjs';
import './photo-online-regression.mjs';
import './ocr-crop-regression.mjs';
import './code-coverage-regression.mjs';
import './annual-contract-regression.mjs';
import './audit-replay-summary-regression.mjs';
import './recognition-provenance-regression.mjs';
import './windows-code-evidence-regression.mjs';
import './independent-code-provenance-regression.mjs';
import './photo-code-audit-retention-regression.mjs';
import './photo-capture-evidence-regression.mjs';
import './full-code-prefix-retention-regression.mjs';
import './portable-code-retention-regression.mjs';
import './portable-conflict-review-regression.mjs';
import './detected-code-dispatch-regression.mjs';
import './detected-code-review-regression.mjs';
import './detected-code-word-review-regression.mjs';
import './replay-comparison-regression.mjs';
import './photo-review-isolation-regression.mjs';
import './release-gates-regression.mjs';
import './photo-availability-regression.mjs';
import './experiments/server-code-reader-regression.mjs';
import './foreground-paper-scene-regression.mjs';
import './body-content-guard-regression.mjs';
import './body-observation-cache-regression.mjs';
import './body-short-field-guard-regression.mjs';
import './photo-upload-body-gate-regression.mjs';
import './photo-upload-input-regression.mjs';
import './photo-upload-receipt-integration.mjs';
import './ocr-long-path-regression.mjs';
import './photo-input-binding-regression.mjs';
import './experiments/text-regions-regression.mjs';
import './experiments/clip-role-reader-regression.mjs';
import './experiments/reference-role-reader-regression.mjs';
import './experiments/balanced-reference-role-regression.mjs';
import './experiments/flame-object-regression.mjs';
import './experiments/pdf-image-candidates-regression.mjs';
import './experiments/detected-code-observation-regression.mjs';
import './experiments/detection-cache-regression.mjs';
import './experiments/tiled-text-regions-regression.mjs';
import './experiments/code-window-context-regression.mjs';
import './experiments/body-text-evidence-regression.mjs';
import './experiments/chinese-reader-regression.mjs';
import './experiments/body-probe-summary-regression.mjs';
import './experiments/vertical-body-regions-regression.mjs';
import './horizontal-body-regions-regression.mjs';
import './paper-orientation-regression.mjs';
import './experiments/pdf-visual-body-evidence-regression.mjs';
import './experiments/pdf-visual-body-summary-regression.mjs';
import './experiments/body-field-evidence-regression.mjs';
import './audit-paths-regression.mjs';
import './pdf-line-normalization-regression.mjs';
import './pdf-index-integration.mjs';

const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

await runPhotoPdfCommitRegression();
await runSceneCategoryCapacityRegression();

// 2026-08-30 平台在 119 条供灯订单下超过旧版 10 秒才挂载场景上传 iframe。
// 等待预算必须覆盖迟到窗口，并且只接管明确的场景上传页面。
assert.ok(SCENE_UPLOAD_FRAME_TIMEOUT_MS >= 45000);
assert.equal(isSceneUploadFrameUrl('http://admin.stqifu.com/blessing/toUploadMore/scene?ids=1,2'),true);
assert.equal(isSceneUploadFrameUrl('http://admin.stqifu.com/blessing/list'),false);
let lateSceneFramePolls=0;
const lateSceneFrame={
  url:()=> 'http://admin.stqifu.com/blessing/toUploadMore/scene?ids=1,2',
  locator:()=>({count:async()=>1}),
};
const resolvedLateSceneFrame=await waitForSceneUploadFrame({
  frames:()=> (++lateSceneFramePolls >= 3 ? [lateSceneFrame] : []),
},{timeoutMs:1000,pollMs:0,sleepFn:async()=>{}});
assert.equal(resolvedLateSceneFrame,lateSceneFrame);
assert.equal(lateSceneFramePolls,3);

assert.equal(normalizeAutomationBaseUrl('https://automation.example.test/'),'https://automation.example.test');
assert.equal(normalizeAutomationBaseUrl('http://127.0.0.1:18080/'),'http://127.0.0.1:18080');
assert.throws(()=>normalizeAutomationBaseUrl('http://automation.example.test'),/只允许 HTTPS/);
assert.throws(()=>normalizeAutomationBaseUrl('https://user:pass@automation.example.test'),/不得包含账号/);
const automationSecret='0123456789abcdef0123456789abcdef';
const fixedNonce=Buffer.alloc(24,7);
const fixedNow=Date.parse('2026-08-28T03:04:05.000Z');
const tokenRequest=createTokenRequest({clientId:'prayer-local-v1',secret:automationSecret},{now:()=>fixedNow,randomBytes:()=>fixedNonce});
const tokenTimestamp=String(Math.floor(fixedNow/1000));
const tokenNonce=fixedNonce.toString('base64url');
const expectedSignature=(await import('node:crypto')).default.createHmac('sha256',automationSecret)
  .update(canonicalTokenRequest('prayer-local-v1',tokenTimestamp,tokenNonce),'utf8').digest('hex');
assert.equal(tokenRequest.headers['X-Automation-Timestamp'],tokenTimestamp);
assert.equal(tokenRequest.headers['X-Automation-Nonce'],tokenNonce);
assert.equal(tokenRequest.headers['X-Automation-Signature'],expectedSignature);
const automationRequests=[];
const automationToken='x'.repeat(96);
const automationFetch=async(url,options)=>{
  automationRequests.push({url,options});
  if(String(url).endsWith('/token')) return {ok:true,status:200,json:async()=>({accessToken:automationToken,tokenType:'Bearer',expiresAt:Math.floor(fixedNow/1000)+900,scopes:['automation:status']})};
  return {ok:true,status:200,json:async()=>({authenticated:true,clientId:'prayer-local-v1',scopes:['automation:status'],adminSessionCreated:false})};
};
const automationClient=new AutomationApiClient({baseUrl:'https://automation.example.test',clientId:'prayer-local-v1',secret:automationSecret},{fetchImpl:automationFetch,now:()=>fixedNow,randomBytes:()=>fixedNonce});
assert.deepEqual(await automationClient.status(),{authenticated:true,clientId:'prayer-local-v1',scopes:['automation:status']});
assert.equal(automationRequests.length,2);
assert.equal(automationRequests[0].url,'https://automation.example.test/internal/automation/v1/token');
assert.equal(automationRequests[1].options.headers.Authorization,`Bearer ${automationToken}`);
assert.equal(automationRequests.map((item)=>JSON.stringify(item)).join('\n').includes(automationSecret),false);
automationClient.clear();

const emptyPlanGroup=()=>({count:0,idSetSha256:'0'.repeat(64),items:[]});
const dailyPlanBody={
  schemaVersion:'1.0',businessDate:'2026-08-27',timezone:'Asia/Shanghai',dryRun:true,
  renewalQueueScope:'global-pending-not-date-filtered',canonicalVersion:'daily-plan-id-set-v1',
  canonicalOrderSetSha256:'1'.repeat(64),
  totals:{daily:1,renewal:0,all:1},
  groups:{
    water:{count:1,idSetSha256:'2'.repeat(64),items:[{
      orderId:'123',recordType:'blessing',state:'1',operationState:'0',productType:'qifudeng',
      productCategory:'qifudeng',productName:'供水养净',paperColor:'none',templateId:1,
      quantity:1,unit:'份',blessingImageUploaded:false,sceneImageUploaded:false,
    }]},
    'ordinary-red':emptyPlanGroup(),'ordinary-yellow':emptyPlanGroup(),
    'tablet-red':emptyPlanGroup(),'tablet-yellow':emptyPlanGroup(),
    'renewal-red':emptyPlanGroup(),'renewal-yellow':emptyPlanGroup(),
  },
};
const dailyRequests=[];
const dailyFetch=async(url,options)=>{
  dailyRequests.push({url:String(url),options});
  if(String(url).endsWith('/token')) return {ok:true,status:200,json:async()=>({
    accessToken:automationToken,tokenType:'Bearer',expiresAt:Math.floor(fixedNow/1000)+900,
    scopes:['automation:status','daily:plan:read'],
  })};
  return {ok:true,status:200,json:async()=>structuredClone(dailyPlanBody)};
};
const dailyClient=new AutomationApiClient(
  {baseUrl:'https://automation.example.test',clientId:'prayer-local-v1',secret:automationSecret},
  {fetchImpl:dailyFetch,now:()=>fixedNow,randomBytes:()=>fixedNonce},
);
assert.deepEqual(await dailyClient.dailyPlan('2026-08-27'),dailyPlanBody);
assert.match(dailyRequests[1].url,/\/internal\/automation\/v1\/daily\/plan\?businessDate=2026-08-27&dryRun=true$/);
assert.equal(dailyRequests[1].options.headers.Authorization,`Bearer ${automationToken}`);
await assert.rejects(()=>dailyClient.dailyPlan('2026-02-30'),/日期无效/);
const limitedClient=new AutomationApiClient(
  {baseUrl:'https://automation.example.test',clientId:'prayer-local-v1',secret:automationSecret},
  {fetchImpl:automationFetch,now:()=>fixedNow,randomBytes:()=>fixedNonce},
);
await assert.rejects(()=>limitedClient.dailyPlan('2026-08-27'),/缺少权限：daily:plan:read/);
const mismatchClient=new AutomationApiClient(
  {baseUrl:'https://automation.example.test',clientId:'prayer-local-v1',secret:automationSecret},
  {fetchImpl:async(url)=>String(url).endsWith('/token')
    ? {ok:true,status:200,json:async()=>({accessToken:automationToken,tokenType:'Bearer',expiresAt:Math.floor(fixedNow/1000)+900,scopes:['daily:plan:read']})}
    : {ok:true,status:200,json:async()=>({...structuredClone(dailyPlanBody),businessDate:'2026-08-26'})},
   now:()=>fixedNow,randomBytes:()=>fixedNonce},
);
await assert.rejects(()=>mismatchClient.dailyPlan('2026-08-27'),/日期或版本不一致/);

const completeLegacyManifest={
  fileSetHash:'legacy-file-set',blessingReady:true,uploadReady:true,batchCompleteReady:true,
  counts:{blessing:15,pdfPages:15,missingBlessing:0,extraBlessing:0},
  files:{blessing:Array.from({length:15},(_,index)=>`${index+1}.jpg`)},
  pdfs:['810红纸1.pdf','810黄纸1.pdf'],blockingErrors:[],manualIssues:[],
  fileHashes:Object.fromEntries(Array.from({length:15},(_,index)=>[`${index+1}.jpg`,`hash-${index+1}`])),
};
assert.deepEqual(resolveHistoricalPhotoClosureEvidence({historicalManifest:{orderCount:164},manifest:null}),{
  proven:true,source:'historical-order-manifest',historicalOrderCount:164,legacyPdfPageCount:0,
});
assert.deepEqual(resolveHistoricalPhotoClosureEvidence({manifest:completeLegacyManifest}),{
  proven:true,source:'verified-legacy-pdf-photo-manifest',historicalOrderCount:0,legacyPdfPageCount:15,
});
assert.equal(resolveHistoricalPhotoClosureEvidence({manifest:{...completeLegacyManifest,batchCompleteReady:false}}).proven,false);
assert.equal(resolveHistoricalPhotoClosureEvidence({manifest:{...completeLegacyManifest,counts:{...completeLegacyManifest.counts,missingBlessing:1}}}).proven,false);
assert.equal(resolveHistoricalPhotoClosureEvidence({manifest:{...completeLegacyManifest,pdfs:[]}}).proven,false);
assert.deepEqual(evaluatePhotoOnlineRecheck({
  onlineUploadedCount:32,onlineNotUploadedCount:0,pendingRegularCount:0,pendingTabletCount:0,historicalEvidenceProven:true,
}),{
  complete:true,onlineUploadedCount:32,onlineNotUploadedCount:0,pendingRegularCount:0,pendingTabletCount:0,
  onlinePendingCount:0,historicalEvidenceProven:true,reason:'online-zero-pending-verified',
});
assert.equal(evaluatePhotoOnlineRecheck({onlineNotUploadedCount:1,historicalEvidenceProven:true}).complete,false);
assert.equal(evaluatePhotoOnlineRecheck({pendingRegularCount:1,historicalEvidenceProven:true}).reason,'online-pending-remains');
assert.equal(evaluatePhotoOnlineRecheck({pendingTabletCount:1,historicalEvidenceProven:true}).onlinePendingCount,1);
assert.equal(evaluatePhotoOnlineRecheck({historicalEvidenceProven:false}).reason,'missing-historical-evidence');

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
  const result=await scheduleSiteClick({elementHandle:async()=>({
    evaluate:async(callback,token)=>callback({
      click:()=>{scheduledClickCount+=1;},
      setAttribute:(name,value)=>{ if (name === 'data-prayer-confirm-consumed') consumedClickToken=value; },
    },token),
    dispose:async()=>{},
  })},{markConsumed:true});
  scheduleReturned=result==='scheduled';
} finally {
  globalThis.setTimeout=originalSetTimeout;
}
assert.equal(scheduleReturned,true);
assert.equal(scheduledClickCount,1);
assert.match(consumedClickToken,/^prayer-/);
const missingTransientClick=await scheduleSiteClick({
  elementHandle:async()=>{ throw new Error('locator.elementHandle: Timeout 750ms exceeded. waiting for locator'); },
},{markConsumed:true,timeoutMs:750,allowMissing:true});
assert.equal(missingTransientClick,'skipped');
await assert.rejects(
  scheduleSiteClick({elementHandle:async()=>{ throw new Error('locator.elementHandle: Timeout 750ms exceeded.'); }},{timeoutMs:750}),
  /Timeout 750ms exceeded/,
);
const vanishedConfirmCandidate={
  getAttribute:async()=>null,
  isVisible:async()=>true,
  elementHandle:async()=>{ throw new Error('locator.elementHandle: Timeout 750ms exceeded. waiting for locator'); },
};
const transientConfirmSite=Object.create(PrayerSite.prototype);
transientConfirmSite.page={
  locator:(selector)=>selector.includes('layui-layer-msg')
    ? {allInnerTexts:async()=>[]}
    : {count:async()=>1,nth:()=>vanishedConfirmCandidate},
};
transientConfirmSite.layerMessages=[];
transientConfirmSite.timing={count:()=>{ throw new Error('消失的确认层不应计为浏览器点击'); }};
transientConfirmSite.log=()=>{};
assert.equal(await transientConfirmSite.autoSiteConfirm(5),0);

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
// 2026-08-28 构图回归：红纸与木架/神像连色后，检测框几乎覆盖整幅照片，
// 但实际福单仍位于稳定的下半幅相机区域。PDF 指纹必须同时尝试该固定纸面
// 裁框，并在错误几何把横版误报成竖版时回退全部未认领 PDF 页面。
const shiftedShapePhoto=path.join(localShapeRoot,'shifted-photo.jpg');
const shiftedPage=await sharp(shapePageOne).resize(576,432,{fit:'fill'}).png().toBuffer();
await sharp({create:{width:1200,height:900,channels:3,background:'#8c6a3e'}})
  .composite([{input:shiftedPage,left:342,top:455}]).jpeg({quality:94}).toFile(shiftedShapePhoto);
const shiftedShapeItems=[{file:shiftedShapePhoto,reliable:false,number:null,candidates:[],visualMetrics:{},paperGeometry:{left:.26,top:.01,width:.61,height:.98,right:.87,bottom:.99,score:.3,fill:.5,boxArea:.60,usablePaper:true,rectangularPaper:false}}];
const shiftedShapeResult=await matchPdfPagesLocally(shiftedShapeItems,shapePages);
assert.equal(shiftedShapeResult.resolved,1);
assert.equal(shiftedShapeItems[0].number,401);
const claimedShapeItems=[{file:shapePhoto,reliable:false,number:null,candidates:[],visualMetrics:{},paperGeometry:{left:0.1,top:140/900,width:0.8,height:640/900,right:0.9,bottom:(140+640)/900,score:0.5,fill:0.95,boxArea:0.56,rectangularPaper:true}}];
const claimedShapeResult=await matchPdfPagesLocally(claimedShapeItems,shapePages,null,new Set([402]));
// One unclaimed page is not a measurable fingerprint margin.  It must remain
// unresolved instead of manufacturing a score difference against zero.
assert.equal(claimedShapeResult.resolved,0);
assert.equal(claimedShapeItems[0].number,null);
assert.deepEqual(claimedShapeResult.diagnostics[0].top.map((item)=>item.number),[401]);
const allClaimedShapeItems=[{file:shapePhoto,reliable:false,number:null,candidates:[],visualMetrics:{},paperGeometry:{left:0.1,top:140/900,width:0.8,height:640/900,right:0.9,bottom:(140+640)/900,score:0.5,fill:0.95,boxArea:0.56,rectangularPaper:true}}];
const allClaimedShapeResult=await matchPdfPagesLocally(allClaimedShapeItems,shapePages,null,new Set([401,402]));
assert.equal(allClaimedShapeResult.status,'not-needed');
assert.equal(allClaimedShapeResult.resolved,0);
const confirmedPdfClaim=[{
  file:shapePhoto,reliable:true,number:401,candidates:[],visualMetrics:{},
  evidence:{method:'targeted-landscape-code-threshold-consensus'},
  paperGeometry:{left:0.1,top:140/900,width:0.8,height:640/900,right:0.9,bottom:(140+640)/900,score:0.5,fill:0.95,boxArea:0.56,rectangularPaper:true},
}];
const confirmedPdfRecheck=await recheckReliablePhotoClaimsWithPdf(confirmedPdfClaim,shapePages);
assert.equal(confirmedPdfRecheck.attempted,1);
assert.equal(confirmedPdfRecheck.confirmed,1);
assert.equal(confirmedPdfRecheck.rejected,0);
assert.equal(confirmedPdfClaim[0].evidence.pdfRecheck.status,'confirmed');
const contradictedPdfClaim=[{
  file:shapePhoto,reliable:true,number:402,candidates:[],visualMetrics:{},
  evidence:{method:'targeted-landscape-code-threshold-consensus'},
  paperGeometry:{left:0.1,top:140/900,width:0.8,height:640/900,right:0.9,bottom:(140+640)/900,score:0.5,fill:0.95,boxArea:0.56,rectangularPaper:true},
}];
const contradictedPdfRecheck=await recheckReliablePhotoClaimsWithPdf(contradictedPdfClaim,shapePages);
assert.equal(contradictedPdfRecheck.confirmed,0);
assert.equal(contradictedPdfRecheck.rejected,1);
assert.equal(contradictedPdfClaim[0].reliable,false);
assert.equal(contradictedPdfClaim[0].pdfRecheck.reason,'pdf-fingerprint-prefers-another-page');
const numericFilenameConflict=[{
  file:shapePhoto,reliable:true,number:401,observedOcrNumber:402,candidates:[],visualMetrics:{},
  observedOcrEvidence:{method:'photo-code-multi-crop-consensus',votes:2,prefixDistance:0,maxConfidence:80},
  evidence:{method:'existing-numeric-filename-claim'},paperGeometry:{},
}];
const numericFilenameConflictResult=await recheckReliablePhotoClaimsWithPdf(numericFilenameConflict,shapePages);
assert.equal(numericFilenameConflictResult.rejected,1);
assert.equal(numericFilenameConflict[0].pdfRecheck.reason,'visible-code-disagrees-with-filename');
const weakNumericFilenameConflict=[{
  file:shapePhoto,reliable:true,number:401,observedOcrNumber:402,candidates:[],visualMetrics:{},
  observedOcrEvidence:{method:'windows-ocr-strict-lower-code-box',votes:1,prefixDistance:0,maxConfidence:100},
  evidence:{method:'existing-numeric-filename-claim'},paperGeometry:{},
}];
const weakNumericFilenameConflictResult=await recheckReliablePhotoClaimsWithPdf(weakNumericFilenameConflict,shapePages);
assert.equal(weakNumericFilenameConflictResult.rejected,0);
assert.equal(weakNumericFilenameConflictResult.inconclusive,1);
assert.equal(weakNumericFilenameConflict[0].reliable,false,'an unconfirmed old filename must not grant upload permission');
const strongVisibleCodeClaim=[{
  file:shapePhoto,reliable:true,number:402,candidates:[],visualMetrics:{},paperGeometry:{},
  evidence:{method:'targeted-landscape-code-threshold-consensus',votes:4,maxConfidence:91},
}];
const strongVisibleCodeResult=await recheckReliablePhotoClaimsWithPdf(strongVisibleCodeClaim,shapePages);
assert.equal(strongVisibleCodeResult.confirmed,1);
assert.equal(strongVisibleCodeResult.rejected,0);
assert.equal(strongVisibleCodeClaim[0].evidence.pdfRecheck.method,'multi-crop-visible-code-and-pdf-index');
// A global one-to-one pass may promote a photo after preserving the original
// multi-crop OCR votes.  The bookkeeping method name must not make the later
// PDF shape check discard that clear visible code.
const globallyResolvedVisibleCodeClaim=[{
  file:shapePhoto,reliable:true,number:402,candidates:[],visualMetrics:{},paperGeometry:{},
  evidence:{method:'global-one-to-one-remaining-pdf-candidate',votes:2,prefixDistance:0,maxConfidence:92,layouts:['paper-relative-code-only','current-temple-code-line']},
}];
const globallyResolvedVisibleCodeResult=await recheckReliablePhotoClaimsWithPdf(globallyResolvedVisibleCodeClaim,shapePages);
assert.equal(globallyResolvedVisibleCodeResult.confirmed,1);
assert.equal(globallyResolvedVisibleCodeResult.rejected,0);
assert.equal(globallyResolvedVisibleCodeClaim[0].evidence.pdfRecheck.method,'multi-crop-visible-code-and-pdf-index');
// 重复号的 7/9 全局修复不能复用原 OCR 的“可见编号已确认”捷径；即使原
// 证据有两票，也必须进入 PDF 正文指纹。这里照片内容属于 401，却暂列为
// 402，复核必须拒绝，证明第二层不是只检查编号是否存在。
const sevenNinePendingFingerprintClaim=[{
  file:shapePhoto,reliable:true,number:402,candidates:[],visualMetrics:{},
  paperGeometry:{left:0.1,top:140/900,width:0.8,height:640/900,right:0.9,bottom:(140+640)/900,score:0.5,fill:0.95,boxArea:0.56,rectangularPaper:true},
  // 即使方法名仍属于 normally trusted 的双票 OCR，只要重复号裁决设置了
  // requiresPdfFingerprintRecheck，就不得走“编号存在即确认”的快捷路径。
  evidence:{method:'targeted-landscape-code-threshold-consensus',votes:2,prefixDistance:0,maxConfidence:40,requiresPdfFingerprintRecheck:true},
}];
const sevenNinePendingFingerprintResult=await recheckReliablePhotoClaimsWithPdf(sevenNinePendingFingerprintClaim,shapePages);
assert.equal(sevenNinePendingFingerprintResult.confirmed,0);
assert.equal(sevenNinePendingFingerprintResult.rejected,1);
assert.equal(sevenNinePendingFingerprintClaim[0].pdfRecheck.reason,'pdf-fingerprint-prefers-another-page');
const persistedDirectVisibleCodeClaim=[{
  file:shapePhoto,reliable:true,number:402,candidates:[],visualMetrics:{},paperGeometry:{},
  evidence:{votes:2,prefixDistance:0,maxConfidence:92,layouts:['current-temple-code-line','current-temple-code-micro']},
}];
const persistedDirectVisibleCodeResult=await recheckReliablePhotoClaimsWithPdf(persistedDirectVisibleCodeClaim,shapePages);
assert.equal(persistedDirectVisibleCodeResult.confirmed,1);
assert.equal(persistedDirectVisibleCodeResult.rejected,0);
assert.equal(persistedDirectVisibleCodeClaim[0].evidence.pdfRecheck.method,'multi-crop-visible-code-and-pdf-index');
const strictVisibleCodeBoxClaim=[{
  file:shapePhoto,reliable:true,number:402,candidates:[],visualMetrics:{},paperGeometry:{},
  evidence:{method:'windows-ocr-strict-lower-code-box',votes:1,prefixDistance:0,maxConfidence:100},
}];
const strictVisibleCodeBoxResult=await recheckReliablePhotoClaimsWithPdf(strictVisibleCodeBoxClaim,shapePages);
assert.equal(strictVisibleCodeBoxResult.confirmed,1);
assert.equal(strictVisibleCodeBoxResult.rejected,0);
assert.equal(strictVisibleCodeBoxClaim[0].evidence.pdfRecheck.method,'strict-visible-code-box-and-pdf-index');
const strictPaperRelativeWindowsCodeClaim=[{
  file:shapePhoto,reliable:true,number:402,candidates:[],visualMetrics:{},paperGeometry:{},
  evidence:{method:'windows-ocr-strict-code-crop',votes:1,prefixDistance:0.25,maxConfidence:100,layouts:['paper-relative-code-only']},
}];
const strictPaperRelativeWindowsCodeResult=await recheckReliablePhotoClaimsWithPdf(strictPaperRelativeWindowsCodeClaim,shapePages);
assert.equal(strictPaperRelativeWindowsCodeResult.confirmed,1);
assert.equal(strictPaperRelativeWindowsCodeResult.rejected,0);
assert.equal(strictPaperRelativeWindowsCodeClaim[0].evidence.pdfRecheck.method,'strict-visible-code-box-and-pdf-index');
const continuousAnchoredSequenceClaim=[{
  file:shapePhoto,reliable:true,number:402,candidates:[],visualMetrics:{},paperGeometry:{},
  evidence:{method:'capture-ascending-sequence-between-code-anchors',votes:3,prefixDistance:null,maxConfidence:null,layouts:[]},
}];
const continuousAnchoredSequenceResult=await recheckReliablePhotoClaimsWithPdf(continuousAnchoredSequenceClaim,shapePages);
assert.equal(continuousAnchoredSequenceResult.confirmed,1);
assert.equal(continuousAnchoredSequenceResult.rejected,0);
assert.equal(continuousAnchoredSequenceClaim[0].evidence.pdfRecheck.method,'continuous-capture-sequence-and-pdf-index');
// 2026-09-02 real failure, anonymized: the first capture visibly contained the
// exact PDF prefix and suffix, and three continuous anchors proved the leading
// gap. A grayscale page ranking preferred another same-template page by only a
// few thousandths and used to overturn the correct printed number.
const visibleLeadingGapClaim=[{
  file:shapePhoto,reliable:true,number:402,visualMetrics:{},
  candidates:[{number:402,votes:1,prefixDistance:0,maxConfidence:46}],
  paperGeometry:{left:0.1,top:140/900,width:0.8,height:640/900,right:0.9,bottom:(140+640)/900,score:0.5,fill:0.95,boxArea:0.56,usablePaper:true},
  evidence:{method:'capture-leading-gap-before-code-anchor',votes:3,prefixDistance:null,maxConfidence:null,layouts:[]},
}];
const visibleLeadingGapResult=await recheckReliablePhotoClaimsWithPdf(visibleLeadingGapClaim,shapePages);
assert.equal(visibleLeadingGapResult.confirmed,1);
assert.equal(visibleLeadingGapResult.rejected,0);
assert.equal(visibleLeadingGapClaim[0].evidence.pdfRecheck.method,'exact-visible-code-candidate-plus-capture-gap-and-pdf-index');
const weakLeadingGapClaim=[{
  ...visibleLeadingGapClaim[0],reliable:true,
  candidates:[{number:402,votes:1,prefixDistance:0,maxConfidence:34}],
  evidence:{method:'capture-leading-gap-before-code-anchor',votes:3,prefixDistance:null,maxConfidence:null,layouts:[]},
}];
const weakLeadingGapResult=await recheckReliablePhotoClaimsWithPdf(weakLeadingGapClaim,shapePages);
assert.equal(weakLeadingGapResult.rejected,1);
assert.equal(weakLeadingGapClaim[0].pdfRecheck.reason,'pdf-fingerprint-prefers-another-page');
const unreadableExistingFilename=[{
  file:shapePhoto,reliable:true,number:401,observedOcrNumber:null,candidates:[],visualMetrics:{},paperGeometry:{},
  evidence:{method:'existing-numeric-filename-claim'},
}];
const unreadableExistingResult=await recheckReliablePhotoClaimsWithPdf(unreadableExistingFilename,shapePages);
assert.equal(unreadableExistingResult.inconclusive,1);
assert.equal(unreadableExistingResult.rejected,0);
assert.equal(unreadableExistingFilename[0].reliable,false,'unreadable is inconclusive, not a confirmed filename');
const unreadableNewProposal=[{
  file:shapePhoto,reliable:true,number:401,candidates:[],visualMetrics:{},paperGeometry:{},
  evidence:{method:'capture-gap-after-existing-number-exclusion',votes:3},
}];
const unreadableNewResult=await recheckReliablePhotoClaimsWithPdf(unreadableNewProposal,shapePages);
assert.equal(unreadableNewResult.inconclusive,1,'missing fingerprint is not a proven wrong number');
assert.equal(unreadableNewResult.rejected,0,'must not block unrelated confirmed photographs');
assert.equal(unreadableNewResult.confirmed,0,'must not accept the unsupported proposal either');
assert.equal(unreadableNewProposal[0].reliable,false,'unproven new photo stays unassigned');
assert.equal(unreadableNewProposal[0].pdfRecheck.reason,'paper-fingerprint-unavailable');
const standardTopEdgeLayouts=targetedCurrentCodeLayouts([
  {name:'paper-relative-landscape-code-upper-right'},
  {name:'paper-relative-landscape-code-lower-right'},
  {name:'paper-relative-code-only'},
  {name:'current-temple-code-line'},
  {name:'current-outdoor-code-line'},
  {name:'current-portrait-code-line'},
]);
assert.equal(standardTopEdgeLayouts[0].name,'paper-relative-code-only');
assert.equal(standardTopEdgeLayouts.length,6);
const raisedOutdoorLayouts=targetedCurrentCodeLayouts([
  {name:'current-outdoor-upper-code-line'},
  {name:'current-outdoor-code-line'},
]);
assert.equal(raisedOutdoorLayouts.some((item)=>item.name==='current-outdoor-upper-code-line'),true);
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
assert.equal(isCaptchaInputDescriptor({id:'code',placeholder:'请输入验证码'}),true);
assert.equal(isCaptchaInputDescriptor({name:'captchaCode'}),true);
assert.equal(isCaptchaInputDescriptor({id:'loginName',placeholder:'请输入账号'}),false);
assert.match(CAPTCHA_INPUT_SELECTOR,/#code:visible/);
assert.match(CAPTCHA_INPUT_SELECTOR,/placeholder\*="验证码"/);
const loginCredentialMarker=path.join(os.tmpdir(),`prayer-login-${process.pid}.dat`);
fs.writeFileSync(loginCredentialMarker,'encrypted-test-marker');
let submittedCaptchaLogin=false;
const filledLoginFields={username:'',password:''};
const captchaLoginSite=new PrayerSite(os.tmpdir(),{count:()=>{}},()=>{}, {
  credentialPath:loginCredentialMarker,
  credentialHelperPath:'test-helper.ps1',
  credentialReader:()=>({username:'admin',password:'secret'}),
});
captchaLoginSite.page={locator:(selector)=>{
  if (selector === CAPTCHA_INPUT_SELECTOR) return {count:async()=>1};
  if (selector === 'input[type="password"]:visible') return {first:()=>({count:async()=>1,fill:async(value)=>{filledLoginFields.password=value;}})};
  if (selector === '#loginName:visible') return {first:()=>({count:async()=>1,fill:async(value)=>{filledLoginFields.username=value;}})};
  if (/loginBtn|type="submit"|has-text/.test(selector)) return {first:()=>({count:async()=>1,elementHandle:async()=>({evaluate:async()=>{submittedCaptchaLogin=true;},dispose:async()=>{}})})};
  return {first:()=>({count:async()=>0})};
}};
assert.equal(await captchaLoginSite.tryStoredLogin(),'captcha-required');
assert.deepEqual(filledLoginFields,{username:'admin',password:'secret'});
assert.equal(submittedCaptchaLogin,false);
const invalidCredentialLogs=[];
const invalidCredentialSite=new PrayerSite(os.tmpdir(),{count:()=>{}},(message)=>invalidCredentialLogs.push(message),{
  credentialPath:loginCredentialMarker,
  credentialHelperPath:'test-helper.ps1',
  credentialReader:()=>{throw new Error('cannot decrypt');},
});
invalidCredentialSite.page=captchaLoginSite.page;
assert.equal(await invalidCredentialSite.tryStoredLogin(),'manual-required');
assert.match(invalidCredentialLogs.join('\n'),/改为手动登录/);
fs.rmSync(loginCredentialMarker,{force:true});
const siteSource=fs.readFileSync(new URL('../src/site.mjs',import.meta.url),'utf8');
const runnerSource=fs.readFileSync(new URL('../src/runner.mjs',import.meta.url),'utf8');
assert.match(siteSource,/始终查询完整的“福单已上传 \+ 场景图未上传”集合/);
assert.doesNotMatch(siteSource,/queryUploadedOrders\(date, \{ productMode: mode === 'water' \? 'water' : 'all', sceneStatus: '未上传' \}\)/);
assert.match(siteSource,/connectOverCDP/);
assert.match(siteSource,/this\.loginTimeoutMs/);
assert.match(siteSource,/readEncryptedWindowsCredential/);
assert.match(siteSource,/this\.autoLoginAttempted = true/);
assert.match(siteSource,/Windows 加密凭据提交登录/);
assert.match(siteSource,/账号和密码已从 Windows 加密凭据安全填入/);
assert.match(siteSource,/return 'captcha-required'/);
assert.match(siteSource,/loginMode === 'captcha-required'/);
assert.match(siteSource,/return 'manual-required'/);
assert.match(siteSource,/loginMode === 'manual-required'/);
assert.match(siteSource,/input\[type=\\?"password\\?"\]/);
assert.doesNotMatch(siteSource,/--password|process\.env\.(?:PRAYER_)?PASSWORD/);
assert.match(siteSource,/快速线上检查发现尚未登录/);
assert.match(siteSource,/recoverClosedBrowser/);
assert.match(siteSource,/browserRecoveryAttempts >= 1/);
assert.match(siteSource,/cleanupTransientPages/);
assert.match(siteSource,/1000条\/页设置第/);
assert.match(siteSource,/连续3次没有生效/);
assert.match(siteSource,/queryDailyTablet[\s\S]*await this\.queryLamp\(date\)/);
assert.doesNotMatch(siteSource,/launchPersistentContext/);
assert.doesNotMatch(siteSource,/browser-profile-backup/);
assert.match(runnerSource,/secure-automation\.dat/);
assert.match(runnerSource,/args\.action === 'automation-auth-check'/);
assert.match(runnerSource,/未创建后台人员会话/);
assert.doesNotMatch(runnerSource,/--automation-secret|process\.env\.(?:PRAYER_)?AUTOMATION_SECRET/);

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
assert.match(partialManifest.warnings.join('\n'),/已确认照片可先上传/);

// 历史/当日缺图批次只应要求“已经到达并可上传的福单”所需场景图。
// 真实故障：供水 PDF 的全部页面均待补，而现有红黄纸福单和两张供灯场景
// 已齐；旧逻辑仍因目录中存在供水 PDF 而阻断整批供灯订单。
const categoryPartialRoot=path.join(dir,'category-partial-business');
const categoryPartialDay=path.join(categoryPartialRoot,'8月25日');
const categoryPartialPhotos=path.join(categoryPartialDay,'1');
fs.mkdirSync(categoryPartialPhotos,{recursive:true});
const categoryWaterDoc=await PDFDocument.create(); categoryWaterDoc.addPage();
const categoryLampDoc=await PDFDocument.create(); categoryLampDoc.addPage();
fs.writeFileSync(path.join(categoryPartialDay,'825供水.pdf'),await categoryWaterDoc.save());
fs.writeFileSync(path.join(categoryPartialDay,'825红纸1.pdf'),await categoryLampDoc.save());
await sharp({create:{width:1800,height:1350,channels:3,background:'#bb3344'}}).jpeg({quality:90}).toFile(path.join(categoryPartialPhotos,'503.jpg'));
await sharp({create:{width:1800,height:1350,channels:3,background:'#202020'}}).jpeg({quality:90}).toFile(path.join(categoryPartialPhotos,'2.1.jpg'));
await sharp({create:{width:1800,height:1350,channels:3,background:'#303030'}}).jpeg({quality:90}).toFile(path.join(categoryPartialPhotos,'2.2.jpg'));
const categoryPartialManifest=await scanPhotoWorkday(categoryPartialRoot,'2026-08-25',path.join(dir,'category-partial-run'),{
  runOcr:false,
  expectedNumbers:new Set([496,503]),
  expectedNumberModes:new Map([[496,'water'],[503,'lamp']]),
});
assert.equal(categoryPartialManifest.counts.missingBlessing,1);
assert.equal(categoryPartialManifest.counts.waterScene,0);
assert.equal(categoryPartialManifest.counts.lampScene,2);
assert.deepEqual(categoryPartialManifest.requiredSceneModes,['lamp']);
assert.equal(categoryPartialManifest.sceneManualIssues.length,0);
assert.equal(categoryPartialManifest.uploadReady,true);

await sharp({create:{width:1800,height:1350,channels:3,background:'#447799'}}).jpeg({quality:90}).toFile(path.join(categoryPartialPhotos,'496.jpg'));
const categoryWaterArrivedManifest=await scanPhotoWorkday(categoryPartialRoot,'2026-08-25',path.join(dir,'category-water-arrived-run'),{
  runOcr:false,
  expectedNumbers:new Set([496,503]),
  expectedNumberModes:new Map([[496,'water'],[503,'lamp']]),
});
assert.deepEqual(categoryWaterArrivedManifest.requiredSceneModes,['water','lamp']);
assert.match(categoryWaterArrivedManifest.sceneManualIssues.join('\n'),/缺少已确认的供水场景图/);

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
const prepareReceipt=await applyPhotoPreparation({ready:true,issues:[],businessDate:'2026-08-09',photoDir:preparePhotoDir,photoInputBinding:createPhotoInputBinding(preparePhotoDir,[prepareSource]),assignments:[{source:prepareSource,targetName:'224.jpg',kind:'blessing',evidence:{method:'test'}}]},prepareWorkDir);
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
const namedReceipt=await applyPhotoPreparation({ready:true,issues:[],businessDate:'2026-08-22',photoDir:namedPhotoDir,photoInputBinding:createPhotoInputBinding(namedPhotoDir,[namedSource]),assignments:[{source:namedSource,targetName:'451.jpg',kind:'blessing',evidence:{method:'already-numbered-spec-normalization'}}]},namedWorkDir);
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
const collisionReceipt=await applyPhotoPreparation({ready:true,issues:[],businessDate:'2026-08-24',photoDir:collisionPhotoDir,photoInputBinding:createPhotoInputBinding(collisionPhotoDir,[occupied491,actual491]),assignments:[
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
const incrementalReceipt=await applyPhotoPreparation({ready:false,safeToApply:true,issues:[],pendingIssues:['仍缺少照片'],businessDate:'2026-08-10',photoDir:incrementalPhotoDir,photoInputBinding:createPhotoInputBinding(incrementalPhotoDir,[incrementalSource]),assignments:[{source:incrementalSource,targetName:'225.jpg',kind:'blessing',evidence:{method:'test'}}]},incrementalWorkDir);
assert.equal(incrementalReceipt.processedCount,1);
assert.equal(fs.existsSync(path.join(incrementalPhotoDir,'225.jpg')),true);
const uiSource=fs.readFileSync(new URL('../ui/PrayerAssistant.ps1',import.meta.url),'utf8');
assert.match(uiSource,/自动处理并编号/);
assert.ok(uiSource.includes(`V${JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version}`));
assert.match(uiSource,/场景分类一致性修复/);
assert.match(uiSource,/重新核对编号/);
assert.match(uiSource,/Start-Runner 'photo-recheck' \$false 'manual' \$true/);
assert.match(runnerSource,/只读编号复核完成/);
assert.match(runnerSource,/没有改名、压缩、上传或修改平台/);
assert.match(runnerSource,/evidence\?\.pdfRecheck\?\.method.*fingerprint/s);
assert.doesNotMatch(uiSource,/配置机器接口|检查接口\/日清单|清除接口凭据/);
assert.match(runnerSource,/client\.dailyPlan\(businessDate\)/);
assert.match(uiSource,/WorkingArea/);
assert.match(uiSource,/Update-ResponsiveLayout/);
assert.match(uiSource,/等待平台登录：请在祈福专用 Edge 完成登录/);
assert.match(uiSource,/\$photoDateDefault = \$today\.AddDays\(-1\)/);
assert.match(uiSource,/\$pdfDateDefault = \$today/);
assert.match(uiSource,/China Standard Time/);
assert.doesNotMatch(uiSource,/Resolve-SavedBusinessDate/);
assert.doesNotMatch(uiSource,/\$settings\.photoBusinessDate/);
assert.doesNotMatch(uiSource,/\$settings\.pdfBusinessDate/);
assert.doesNotMatch(uiSource,/hasRememberedPhotoDate/);
assert.doesNotMatch(uiSource,/hasRememberedPdfDate/);
assert.match(uiSource,/历史待复核业务/);
assert.match(uiSource,/复核线上并处理未完成项/);
assert.match(uiSource,/先查线上状态，完成后恢复上方日期/);
assert.doesNotMatch(uiSource,/OPENAI_API_KEY/);
assert.match(uiSource,/不会读取 API 密钥/);
assert.match(uiSource,/Test-PhotoInboxHasNewRaw/);
assert.match(uiSource,/\^\\d\+\\\.\\d\+\$/);
assert.match(uiSource,/\$script:initQueue\.Enqueue\('cleanup-local-state'\)/);
assert.match(uiSource,/不触碰 NAS 业务文件/);
assert.match(uiSource,/再次点击照片主按钮只处理新增图片和剩余订单/);
assert.match(uiSource,/waiting-supplement/);
assert.match(uiSource,/请先核对未匹配图片及场景类别，确认缺图后再补图/);
assert.match(uiSource,/Get-PendingPhotoBusinessDates/);
assert.match(uiSource,/已列入独立任务栏；主日期保持/);
assert.match(uiSource,/completedFlow -eq 'backlog'/);
assert.match(uiSource,/Start-Runner 'photo-online-recheck' \$false 'backlog' \$true/);
assert.match(uiSource,/photo-online-closure\.json/);
assert.match(uiSource,/\$hasNewRaw -or \(-not \$terminalComplete/);
assert.match(runnerSource,/queryUploadedOrders\(photoDate/);
assert.match(runnerSource,/queryNotUploadedOrders\(photoDate/);
assert.match(runnerSource,/queryLamp\(photoDate\)/);
assert.match(runnerSource,/queryDailyTablet\(photoDate\)/);
assert.match(runnerSource,/photo-online-closure\.json/);
assert.match(runnerSource,/platformModified:false/);
assert.match(uiSource,/completedFlow -eq 'backlog-photo'/);
assert.match(uiSource,/Continue-BacklogPhotoFlow/);
assert.match(uiSource,/Restore-BacklogPhotoDate/);
assert.match(uiSource,/不会覆盖上方默认日期/);
assert.match(uiSource,/处理已上传订单并继续核对/);
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
assert.match(uiSource,/@\('--login-timeout-ms','600000'\)/);
assert.doesNotMatch(uiSource,/--login-timeout-ms'.*'5000'/);
assert.doesNotMatch(uiSource,/\$scope -eq 'all' -or \$scope -eq 'pdf'\) \{ \$script:initQueue\.Enqueue\('inspect'\)/);
assert.match(uiSource,/ui-workflow-state\.json/);
assert.match(uiSource,/Continue-PhotoFlow/);
assert.match(uiSource,/Test-ShouldAutoResumePhoto/);
assert.match(uiSource,/blockingErrors/);
assert.match(uiSource,/待人工处理/);
assert.match(uiSource,/completedAction -eq 'photo-scan'[\s\S]*Continue-PhotoFlow \$false/);
assert.match(uiSource,/\$script:initQueue\.Clear\(\)[\s\S]*照片预检通过，正在自动续跑/);
assert.match(uiSource,/高级\/故障工具/);
assert.match(uiSource,/SecureCredentialStore\.ps1/);
assert.doesNotMatch(uiSource,/AutomationCredentialStore\.ps1/);
assert.match(uiSource,/UseSystemPasswordChar = \$true/);
assert.match(uiSource,/secure-login\.dat/);
assert.match(uiSource,/登录账号：已配置/);
assert.match(uiSource,/验证码始终由你在 Edge 登录页手动输入/);
assert.doesNotMatch(uiSource,/secure-automation\.dat|automation-auth-check|机器接口：已配置/);
assert.doesNotMatch(uiSource,/password\s*=\s*['"][^'"]+['"]/i);
assert.match(siteSource,/blessing\/mind\/toUpload\/name/);
assert.match(siteSource,/waitForEvent\('filechooser'/);
assert.match(siteSource,/staging-local-upload-cache/);
assert.match(siteSource,/上传文件已复制到本地非同步缓存并完成哈希校验/);
assert.match(siteSource,/fileSha256\(source\) !== fileSha256\(destination\)/);
assert.match(siteSource,/chooser\.setFiles\(files, \{ noWaitAfter:true, timeout:60000 \}\)/);
assert.match(siteSource,/scheduleSiteClick\(chooseButton, \{ markConsumed:true \}\)/);
assert.match(siteSource,/getAttribute\(CONSUMED_CONFIRM_ATTRIBUTE\)/);
assert.doesNotMatch(siteSource,/excludeElements: \[monthButtonHandle\]/);
assert.match(siteSource,/scheduleSiteClick\(candidate, \{[\s\S]*timeoutMs:750,[\s\S]*allowMissing:true/);
assert.match(siteSource,/locator\.elementHandle\(\{ timeout: timeoutMs \}\)/);
assert.doesNotMatch(siteSource,/return locator\.evaluate\(\(element, token\)/);
assert.doesNotMatch(siteSource,/if \(!confirmed\) throw new Error\('没有识别到“确认要上传吗”窗口/);
assert.match(siteSource,/scheduleSiteClick\(camera\)/);
assert.match(siteSource,/const monthText = `\$\{year\}\$\{String\(month\)\.padStart\(2, '0'\)\}`/);
assert.doesNotMatch(siteSource,/const monthText = `\$\{year\}\//);
assert.match(runnerSource,/manual-online-closure-reconciled/);
assert.match(runnerSource,/resolveHistoricalPhotoClosureEvidence/);
assert.match(runnerSource,/当前福单已上传、福单未上传、供灯待祈福和牌位待祈福均为 0/);
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
assert.match(runnerSource,/receipt\.currentBatchFiles = batches\[index\]\.map/);
assert.match(runnerSource,/receipt\.currentBatchStartedAt = new Date\(\)\.toISOString\(\)/);
assert.match(runnerSource,/available-files-complete-waiting-for-supplement/);
assert.match(runnerSource,/个 PDF 编号待匹配.*不阻断现有福单图上传/);
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
assert.deepEqual(resolveBlessingUploadResponseCount({result:{message:'10'}},10),{
  uploadedCount:10,
  numericMessages:[10],
});
assert.deepEqual(resolveBlessingUploadResponseCount('{"result":{"message":"10"}}',10),{
  uploadedCount:10,
  numericMessages:[10],
});
assert.equal(resolveBlessingUploadResponseCount({result:{message:'36'},orderId:10},10).uploadedCount,undefined);
assert.equal(resolveBlessingUploadResponseCount("$('#years').val(laydate.now(0,'YYYYMM'));",10).uploadedCount,undefined);
assert.equal(isBlessingUploadTransport('POST','http://admin.stqifu.com/blessing/mind/uploadPic/name'),true);
assert.equal(isBlessingUploadTransport('post','http://admin.stqifu.com/blessing/mind/uploadPic?month=202609'),true);
assert.equal(isBlessingUploadTransport('GET','http://admin.stqifu.com/blessing/mind/uploadPic/name'),false);
assert.equal(isBlessingUploadTransport('POST','http://admin.stqifu.com/blessing/mind/toUpload/name'),false);
const pdfOrderRows=[{id:'order-a'},{id:'order-b'},{id:'order-c'}];
assert.equal(resolveBlessingOrderSetUploadState(
  pdfOrderRows,
  [{id:'order-a'},{id:'order-b'},{id:'unrelated-new-order'}],
  [{id:'order-c'}],
).state,'partial');
assert.deepEqual(resolveBlessingOrderSetUploadState(
  pdfOrderRows,
  [{id:'order-a'},{id:'order-b'},{id:'order-c'}],
  [{id:'unrelated-new-order'}],
),{
  state:'all-uploaded',expectedCount:3,uploadedCount:3,pendingCount:0,conflictCount:0,
  expectedOrderIdHash:PrayerSite.manifest(pdfOrderRows,'2026-09-03').orderIdHash,
  uploadedOrderIdHash:PrayerSite.manifest(pdfOrderRows,'2026-09-03').orderIdHash,
  pendingOrderIdHash:PrayerSite.manifest([],'2026-09-03').orderIdHash,
  conflictOrderIds:[],
});
assert.equal(resolveBlessingOrderSetUploadState(
  pdfOrderRows,
  [],
  pdfOrderRows,
).state,'none-uploaded');
assert.equal(resolveBlessingOrderSetUploadState(
  pdfOrderRows,
  [{id:'order-a'}],
  [{id:'order-a'},{id:'order-b'}],
).state,'ambiguous');
// Printed page tails are not online order IDs. A coincidental suffix must never
// be accepted as proof that a particular photo uploaded.
assert.equal(resolveBlessingOrderSetUploadState(
  [{id:'long-online-order-29'},{id:'another-online-order-29'}],
  [{id:'long-online-order-29'}],
  [{id:'another-online-order-29'}],
).state,'partial');
const boundLampManifest=PrayerSite.manifest([{id:'lamp-1'},{id:'lamp-2'}],'2026-09-03');
const boundTabletManifest=PrayerSite.manifest([{id:'tablet-1'}],'2026-09-03');
const boundCombinedManifest=PrayerSite.manifest([...boundLampManifest.rows,...boundTabletManifest.rows],'2026-09-03');
const boundScope=resolvePdfBoundPhotoOrderScope({
  businessDate:'2026-09-03',
  photoManifest:{businessDate:'2026-09-03',pdfs:[{sha256:'pdf-a',pageCount:4},{sha256:'pdf-b',pageCount:7}]},
  pdfReceipt:{
    businessDate:'2026-09-03',
    ...boundCombinedManifest,
    lamp:boundLampManifest,
    tablet:boundTabletManifest,
    outputs:[{sha256:'pdf-b',pageCount:7},{sha256:'pdf-a',pageCount:4}],
  },
});
assert.equal(boundScope.proven,true);
assert.equal(boundScope.orderCount,3);
assert.equal(boundScope.includeTablet,true);
assert.equal(resolvePdfBoundPhotoOrderScope({
  businessDate:'2026-09-03',
  photoManifest:{businessDate:'2026-09-03',pdfs:[{sha256:'changed-pdf',pageCount:4}]},
  pdfReceipt:{businessDate:'2026-09-03',outputs:[{sha256:'pdf-a',pageCount:4}]},
}).proven,false);
const transportPage=new EventEmitter();
const transportWatcher=watchBlessingUploadTransport(transportPage,12);
const uploadRequest={method:()=> 'POST',url:()=> 'http://admin.stqifu.com/blessing/mind/uploadPic/name'};
transportPage.emit('request',uploadRequest);
transportPage.emit('response',{
  request:()=>uploadRequest,
  url:()=>uploadRequest.url(),
  ok:()=>true,
  status:()=>200,
  text:async()=>'{"result":{"message":"loading"}}',
});
transportPage.emit('response',{
  request:()=>uploadRequest,
  url:()=>uploadRequest.url(),
  ok:()=>true,
  status:()=>200,
  text:async()=>'{"result":{"message":"12"}}',
});
assert.equal(await transportWatcher.uploadedCount(),12);
assert.equal(transportWatcher.state.requestCount,1);
assert.equal(transportWatcher.state.responseCount,2);
transportWatcher.stop();
assert.equal(transportPage.listenerCount('request'),0);
assert.equal(transportPage.listenerCount('response'),0);
assert.match(siteSource,/watchBlessingUploadTransport/);
assert.doesNotMatch(siteSource,/const uploadResponsePromise = this\.page\.waitForResponse/);
assert.match(siteSource,/BLESSING_UPLOAD_OUTCOME_UNCONFIRMED/);
assert.match(runnerSource,/resolveBlessingOrderSetUploadState/);
assert.match(runnerSource,/resolvePdfBoundPhotoOrderScope/);
assert.match(runnerSource,/PDF文件哈希＋订单ID集合/);
assert.match(runnerSource,/upload-outcome-unconfirmed-no-resubmit/);
assert.match(runnerSource,/uncertainSubmission:previous\?\.uncertainSubmission === true/);
assert.equal((runnerSource.match(/await photoSite\.uploadBlessingBatch\(/g)||[]).length,1,'unknown upload outcome must never trigger a second write');
assert.doesNotMatch(runnerSource,/single-safe-retry-with-unchanged-order-set/);
assert.doesNotMatch(siteSource,/normalizedBlessingTail|resolveBlessingFileUploadStates/);
assert.match(siteSource,/allInnerTexts/);
assert.doesNotMatch(siteSource,/layui-layer-msg:visible[^\n]*\.allTextContents/);
assert.match(siteSource,/const selects = dialog\.locator\('select'\)/);
assert.match(siteSource,/批量修改成\(\?:代理\|延续\)\?已处理状态/);
assert.match(siteSource,/既没有已处理终态选项，也没有明确的/);
assert.match(runnerSource,/照片目录快速清点/);
assert.match(runnerSource,/scanPhotoWorkday\(root,photoDate,photoRunDir,\{runOcr:false,expectedNumbers:allowedBlessingNumbers,expectedNumberModes,excludedPhotoNames\}\)/);
assert.match(runnerSource,/const mode = \/供水\//);
assert.match(runnerSource,/旧版或已失效照片计划/);
assert.match(runnerSource,/不会按旧断点直接上传/);
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
].map((item,index)=>({...item,file:`微信图片_2026030112000${index}_descending.jpg`}));
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
// This fixture previously endorsed guessed tails. A year is NOT a business
// code observation; the unread later export may start at any number.
const unreadTailPages=[
  ...Array.from({length:5},(_,index)=>({pdf:'827红纸1.pdf',pageNumber:index+1,rawNumber:543+index,number:543+index})),
  ...Array.from({length:3},(_,index)=>({pdf:'827红纸2.pdf',pageNumber:index+1,rawNumber:2027,number:null})),
  ...Array.from({length:2},(_,index)=>({pdf:'827黄纸2.pdf',pageNumber:index+1,rawNumber:2027,number:null})),
];
assert.equal(inferTrailingUnreadPdfCodes(unreadTailPages),false);
assert.deepEqual(unreadTailPages.slice(5).map((page)=>page.number),[null,null,null,null,null]);
const unsafeMiddleGapPages=unreadTailPages.map((page)=>({...page}));
unsafeMiddleGapPages[2].number=550;
unsafeMiddleGapPages.slice(5).forEach((page)=>{page.number=null;});
assert.equal(inferTrailingUnreadPdfCodes(unsafeMiddleGapPages),false);

// 单个裁框的一次 OCR 命中不足以成为可靠编号；至少需要两个独立裁框一致。
assert.equal(isReliableOcrConsensus({number:580,votes:1,prefixDistance:0,maxConfidence:92},null,20),false);
assert.equal(isReliableOcrConsensus({number:580,votes:2,prefixDistance:0,maxConfidence:55},null,20),true);
assert.equal(isReliableOcrConsensus({number:580,votes:2,prefixDistance:0,maxConfidence:55},{number:569,votes:2,prefixDistance:0,maxConfidence:70},20),false);
assert.deepEqual(parseLooseWindowsCodeCandidates('26B · 1 · 5g5 1 · 2027','268',new Set([592,593,594,595,596])),[595]);
assert.deepEqual(parseLooseWindowsCodeCandidates('768 刁 77','268',new Set(Array.from({length:54},(_,index)=>543+index))),[577]);
// 2026-08-27 实图：Windows OCR 吞掉业务前缀首位，并把 577 拆成“57 7”。
// 完整三位拼接应优先于把“57”错误补成同批次里的 557。
assert.deepEqual(parseLooseWindowsCodeCandidates('6R · 57 7','268',new Set(Array.from({length:54},(_,index)=>543+index))),[577]);
assert.deepEqual(parseLooseWindowsCodeCandidates('268 一 1 乇 30','268',new Set(Array.from({length:15},(_,index)=>630+index))),[630]);
assert.deepEqual(parseLooseWindowsCodeCandidates('268 一 1 乇 31','268',new Set(Array.from({length:15},(_,index)=>630+index))),[631]);
assert.deepEqual(parseLooseWindowsCodeCandidates('77 2027','268',new Set([577])),[]);
assert.deepEqual(parseLooseWindowsCodeCandidates('768 刁 77','268',new Set([577,677])),[]);
const twoAnchorPhotos=Array.from({length:8},(_,index)=>({
  file:`微信图片_2026030112000${index}_two-anchors.jpg`,
  reliable:index<2,
  number:index<2?339+index:null,
  candidates:[],
  paperGeometry:{rectangularPaper:true,top:0.49,width:0.50,height:0.44,boxArea:0.22,fill:0.74},
  visualMetrics:{edgeDensity:0.20},
}));
inferPhotoSequences(twoAnchorPhotos,new Set(Array.from({length:8},(_,index)=>339+index)));

const lowFillOutdoorPhotos=Array.from({length:5},(_,index)=>(
  index<2
    ? {
      file:`微信图片_2026083010000${index}_${1400+index}_92.jpg`,reliable:true,number:616+index,candidates:[],
      paperGeometry:{rectangularPaper:index===0,score:.24,boxArea:.48,width:.74,height:.65,fill:.49,top:.12},
      visualMetrics:{edgeDensity:.145,upperEdgeDensity:.12},
      evidence:index===0
        ? {method:'targeted-landscape-code-threshold-consensus',votes:4,maxConfidence:91}
        : {method:'windows-ocr-strict-code-crop',votes:1,maxConfidence:100},
    }
    : {
      file:`微信图片_2026083010000${index}_${1400+index}_92.jpg`,reliable:false,number:null,candidates:[],
      paperGeometry:{rectangularPaper:false,usablePaper:false,score:.10,boxArea:.54,width:.80,height:.68,fill:.20,top:.16},
      visualMetrics:{edgeDensity:.15,upperEdgeDensity:.115},sceneMetrics:{darkRatio:.25,warmBrightRatio:.04,luminance:100},
    }
));
inferPhotoSequences(lowFillOutdoorPhotos,new Set([616,617,618,619,620]));
assert.deepEqual(lowFillOutdoorPhotos.map((item)=>item.number),[616,617,618,619,620]);
assert.ok(lowFillOutdoorPhotos.slice(2).every((item)=>item.evidence.method==='capture-ascending-sequence-forward-edge'));

const gapGeometry={usablePaper:true,rectangularPaper:true,score:.2,boxArea:.3,width:.58,height:.49,fill:.7,top:.5};
const gapMetrics={edgeDensity:.12,upperEdgeDensity:.10,uniformity:.35};
const gapPhotos=[486,487,488,489].map((number,index)=>({
  file:`微信图片_2026030112000${index}_gap.jpg`,reliable:index===3,number:index===3?number:null,
  paperGeometry:{...gapGeometry},visualMetrics:{...gapMetrics},candidates:[],evidence:index===3?{method:'ocr'}:null,
}));
inferPhotoGapsAroundExistingNumbers(gapPhotos,new Set([486,487,488,489]),new Set());
assert.deepEqual(gapPhotos.map((item)=>item.number),[486,487,488,489]);
assert.equal(gapPhotos[0].evidence.method,'capture-leading-gap-before-code-anchor');
assert.deepEqual(twoAnchorPhotos.map((item)=>item.number),Array.from({length:8},(_,index)=>339+index));
assert.match(twoAnchorPhotos[2].evidence.method,/ascending/);
// 2026-08-28 真实故障的脱敏回归：603~613 连拍结束 29 秒后，摄影者补拍
// 旧编号 597/598。微信文件流水号仍递增，但拍摄时间已经形成新段，绝不能
// 把两张未识别照片沿前段外推成 614/615。
const resetCapturePhotos=Array.from({length:13},(_,index)=>({
  file:index<11
    ? `微信图片_202608281914${String(3+index*2).padStart(2,'0')}_${1352+index}_92.jpg`
    : `微信图片_202608281914${index===11?'54':'55'}_${1352+index}_92.jpg`,
  reliable:index<11,number:index<11?603+index:null,candidates:[],
  paperGeometry:{usablePaper:true,rectangularPaper:true,score:.22,top:.52,width:.61,height:.47,boxArea:.29,fill:.78},
  visualMetrics:{edgeDensity:.18},
}));
assert.ok(Number.isFinite(photoCaptureTimestamp(resetCapturePhotos[0].file)));
assert.equal(isContinuousPhotoCapture(resetCapturePhotos[10],resetCapturePhotos[11]),false);
inferPhotoSequences(resetCapturePhotos,new Set(Array.from({length:19},(_,index)=>597+index)));
assert.deepEqual(resetCapturePhotos.slice(11).map((item)=>item.number),[null,null]);
const continuousEdgePhotos=resetCapturePhotos.map((item,index)=>({
  ...item,file:`微信图片_202608281914${String(3+index*2).padStart(2,'0')}_${1352+index}_92.jpg`,
  reliable:index<11,number:index<11?603+index:null,evidence:null,
}));
inferPhotoSequences(continuousEdgePhotos,new Set(Array.from({length:19},(_,index)=>597+index)));
assert.deepEqual(continuousEdgePhotos.slice(11).map((item)=>item.number),[614,615]);
const duplicatedSixEightPhotos=[
  {file:'actual-466.jpg',reliable:true,number:468,candidates:[],paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{},evidence:{method:'ocr'}},
  {file:'467.jpg',reliable:true,number:467,candidates:[],paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{}},
  {file:'actual-468.jpg',reliable:true,number:468,candidates:[],paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{}},
  {file:'469.jpg',reliable:true,number:469,candidates:[],paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{}},
].map((item,index)=>({...item,file:`微信图片_2026030112000${index}_six-eight.jpg`}));
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
// 2026-08-31 真实故障的脱敏回归：纸面 659 被主/备 OCR 同时读成 657，
// 另一张真实 657 又使它成为可靠重复号。只有 659 是 PDF 唯一缺号，真实
// 657 为单票 100 分，误读候选为双票 40 分。允许暂列 659，但必须在后续
// recheckReliablePhotoClaimsWithPdf 中强制用 PDF 正文指纹确认。
const duplicatedSevenNinePhotos=[
  {file:'real-657.jpg',reliable:true,number:657,candidates:[{number:657,votes:1,prefixDistance:0,maxConfidence:100}],paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{},evidence:{method:'windows-ocr-strict-code-crop',votes:1,prefixDistance:0,maxConfidence:100}},
  {file:'actual-659.jpg',reliable:true,number:657,candidates:[{number:657,votes:2,prefixDistance:0,maxConfidence:40}],paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{},evidence:{method:'targeted-landscape-code-threshold-consensus',votes:2,prefixDistance:0,maxConfidence:40}},
];
const occupiedSevenNineNumbers=new Set(Array.from({length:12},(_,index)=>650+index).filter((number)=>![657,659].includes(number)));
assert.deepEqual(reconcileDuplicatePhotoNumbers(duplicatedSevenNinePhotos,new Set(Array.from({length:12},(_,index)=>650+index)),occupiedSevenNineNumbers).map((item)=>[item.from,item.to]),[[657,659]]);
assert.equal(duplicatedSevenNinePhotos[0].number,657);
assert.equal(duplicatedSevenNinePhotos[1].number,659);
assert.equal(duplicatedSevenNinePhotos[1].evidence.method,'global-one-to-one-existing-files-seven-nine-pending-pdf-recheck');
assert.equal(duplicatedSevenNinePhotos[1].evidence.requiresPdfFingerprintRecheck,true);
const unsafeSevenNineDuplicate=duplicatedSevenNinePhotos.map((item,index)=>({
  ...item,number:657,evidence:{method:'ocr',votes:index?2:1,maxConfidence:index?72:78},paperGeometry:{usablePaper:true,rectangularPaper:true},
}));
assert.deepEqual(reconcileDuplicatePhotoNumbers(unsafeSevenNineDuplicate,new Set(Array.from({length:12},(_,index)=>650+index)),occupiedSevenNineNumbers),[]);
// 2026-09-02 real failure, anonymized: a JPEG corruption band made a portrait
// red tablet crop hallucinate the number of an already claimed landscape red
// page. The only unclaimed portrait red PDF page closes the full batch exactly.
const structuralPdfPages=[
  {number:23,portrait:false,pdfName:'92红纸1.pdf',_localShapeFingerprint:shapePages[0]._localShapeFingerprint},
  {number:28,portrait:true,pdfName:'92红纸2.pdf',_localShapeFingerprint:shapePages[1]._localShapeFingerprint},
];
const structuralDuplicatePhotos=[
  // Explicit synthetic square canvas preserves the intended physical shapes;
  // these are not measured dimensions of a historical photo.
  {file:'landscape-red.jpg',reliable:true,number:23,candidates:[{number:23,votes:1,prefixDistance:0,maxConfidence:100}],paperGeometry:{usablePaper:true,left:0,top:0,width:.82,height:.58,imageWidth:1000,imageHeight:1000},visualMetrics:{},evidence:{method:'windows-ocr-strict-code-crop',votes:1,prefixDistance:.25,maxConfidence:100}},
  {file:'portrait-red-with-corruption-band.jpg',reliable:true,number:23,candidates:[{number:23,votes:3,prefixDistance:.25,maxConfidence:100}],paperGeometry:{usablePaper:true,left:0,top:0,width:.731,height:.925,imageWidth:1000,imageHeight:1000},visualMetrics:{},evidence:{method:'windows-ocr-strict-code-crop',votes:1,prefixDistance:.25,maxConfidence:100}},
];
const structuralCorrections=await reconcileDuplicatePhotoNumbersByPdfStructure(
  structuralDuplicatePhotos,structuralPdfPages,new Set([23,28]),new Set(),
  {getPaperColor:async()=> 'red'},
);
assert.deepEqual(structuralCorrections.map((item)=>[item.from,item.to]),[[23,28]]);
assert.equal(structuralDuplicatePhotos[0].number,23);
assert.equal(structuralDuplicatePhotos[1].number,28);
assert.equal(structuralDuplicatePhotos[1].evidence.method,'global-one-to-one-pdf-structure-repair');
const structuralRecheck=await recheckReliablePhotoClaimsWithPdf(structuralDuplicatePhotos,structuralPdfPages);
assert.equal(structuralRecheck.rejected,0);
assert.equal(structuralRecheck.confirmed,2);
assert.equal(structuralDuplicatePhotos[1].evidence.pdfRecheck.method,'orientation-color-and-global-pdf-bijection');
const sameOrientationDuplicate=structuralDuplicatePhotos.map((item,index)=>({
  ...item,number:23,reliable:true,
  paperGeometry:{usablePaper:true,left:0,top:0,width:.82,height:.58,imageWidth:1000,imageHeight:1000},
  evidence:{method:'windows-ocr-strict-code-crop',votes:1,prefixDistance:.25,maxConfidence:100},
}));
assert.deepEqual(await reconcileDuplicatePhotoNumbersByPdfStructure(
  sameOrientationDuplicate,structuralPdfPages,new Set([23,28]),new Set(),{getPaperColor:async()=> 'red'},
),[]);
const wrongColorDuplicate=structuralDuplicatePhotos.map((item,index)=>({
  ...item,number:23,reliable:true,
  paperGeometry:{...structuralDuplicatePhotos[index].paperGeometry},
  evidence:{method:'windows-ocr-strict-code-crop',votes:1,prefixDistance:.25,maxConfidence:100},
}));
assert.deepEqual(await reconcileDuplicatePhotoNumbersByPdfStructure(
  wrongColorDuplicate,structuralPdfPages,new Set([23,28]),new Set(),{getPaperColor:async()=> 'yellow'},
),[]);
// OCR 弱候选若指向已被另一张可靠照片占用的编号，应交给全局一一对应处理，
// 不得阻断拍摄序列把当前照片归入唯一缺号。
assert.equal(hasStrongOcrConflict({candidates:[{number:569,votes:2,prefixDistance:0}]},580,new Set([569])),false);
assert.equal(hasStrongOcrConflict({candidates:[{number:568,votes:2,prefixDistance:0}]},580,new Set([569])),true);
assert.equal(hasStrongOcrConflict({candidates:[{number:580,votes:1,prefixDistance:0,maxConfidence:29}]},595,new Set([569])),true);
assert.equal(hasStrongOcrConflict({candidates:[{number:580,votes:1,prefixDistance:0,maxConfidence:9}]},595,new Set([569])),false);
const occupiedDuplicateSequence=[579,580,581,582,583].map((number,index)=>({
  file:`微信图片_2026030112000${index}_occupied.jpg`,
  reliable:index!==1,
  number:index!==1?number:null,
  candidates:index===1?[{number:569,votes:2,prefixDistance:0,maxConfidence:66}]:[],
  paperGeometry:{usablePaper:true,rectangularPaper:true,score:.2,boxArea:.3,width:.58,height:.49,fill:.7,top:.5},
  visualMetrics:{edgeDensity:.12,upperEdgeDensity:.10,uniformity:.42},
}));
inferPhotoGapsAroundExistingNumbers(occupiedDuplicateSequence,new Set([579,580,581,582,583]),new Set([569]));
assert.equal(occupiedDuplicateSequence[1].number,580);
assert.equal(isLikelyScene({paperGeometry:{usablePaper:false,score:0.045,width:0.844,top:0.842,height:0.079,boxArea:0.067},visualMetrics:{uniformity:0.288,upperEdgeDensity:0.175,edgeDensity:0.227}}),true);
assert.equal(isLikelyScene({paperGeometry:{usablePaper:false,score:0.0812,width:1,top:0.875,height:0.125,boxArea:0.125},visualMetrics:{uniformity:0.294,upperEdgeDensity:0.177,edgeDensity:0.229}}),true);
// 2026-08-25 真实故障的脱敏结构回归：近景灯阵被金色灯架连通块误判为
// 大张黄纸。该照片没有矩形纸张，且全画面极低边缘密度、高均匀度，应归为场景图。
assert.equal(isLikelyScene({paperGeometry:{usablePaper:true,rectangularPaper:false,score:0.3311979,width:0.809375,top:0.42917,height:0.57083,fill:0.71685,boxArea:0.4620},visualMetrics:{uniformity:0.67035,upperEdgeDensity:0.01207,edgeDensity:0.03483}}),true);
assert.equal(isLikelyScene({paperGeometry:{usablePaper:true,rectangularPaper:true,width:0.72,top:0.20,height:0.60,boxArea:0.43},visualMetrics:{uniformity:0.30,upperEdgeDensity:0.17,edgeDensity:0.22}}),false);
// 2026-08-25 供水全景：金色台阶会形成一个横跨整幅图的巨大“黄纸”色块，
// 但它没有矩形纸张边界，必须进入场景图而不是福单 OCR。
assert.equal(isLikelyScene({paperGeometry:{usablePaper:true,rectangularPaper:false,score:0.4971875,left:0,top:0.3,width:1,height:0.7,right:1,bottom:1,fill:0.710267857,boxArea:0.7},visualMetrics:{edgeDensity:0.176145833,upperEdgeDensity:0.164973958,uniformity:0.4201041667}}),true);
// 2026-08-26 的供水场景含远处红纸，旧版把下半幅连通色块误作福单主体。
assert.equal(isLikelyScene({paperGeometry:{usablePaper:true,rectangularPaper:false,score:0.223867,left:0.146875,top:0.541667,width:0.853125,height:0.458333,right:1,bottom:1,fill:0.572527,boxArea:0.391016},visualMetrics:{edgeDensity:0.228633,upperEdgeDensity:0.189141,uniformity:0.323086}}),true);
// 同批第二张供灯图上半部细节略多，但色块很小、无可用纸张且整体仍是
// 高均匀度低边缘灯阵，必须与另一张供灯图一起进入场景分类。
assert.equal(isLikelyScene({paperGeometry:{usablePaper:false,rectangularPaper:false,score:0.054023,left:0.121875,top:0.366667,width:0.23125,height:0.3875,right:0.353125,bottom:0.754167,fill:0.602877,boxArea:0.089609},visualMetrics:{edgeDensity:0.102904,upperEdgeDensity:0.085456,uniformity:0.542747}}),true);
// 同批近景福单即使纸张与右边缘相连、矩形标记失败，也不能被新场景规则误伤。
assert.equal(isLikelyScene({paperGeometry:{usablePaper:true,rectangularPaper:false,score:0.520964,left:0.171875,top:0.15,width:0.828125,height:0.704167,right:1,bottom:0.854167,fill:0.893379,boxArea:0.583138},visualMetrics:{edgeDensity:0.114453,upperEdgeDensity:0.089102,uniformity:0.512318}}),false);
// 2026-08-27 真实批次的匿名视觉回归：两张供灯及一张供水必须仍是场景；
// 清晰红/黄福单即使纸色连通域接到底边，也不能再被提前当作场景跳过 OCR。
const august27Scenes=[
  {paperGeometry:{usablePaper:false,rectangularPaper:false,score:.036276,width:.35625,top:.429167,height:.241667,fill:.421355,boxArea:.086094},visualMetrics:{edgeDensity:.122969,upperEdgeDensity:.086432,uniformity:.495013},sceneMetrics:{darkRatio:.66599}},
  {paperGeometry:{usablePaper:false,rectangularPaper:false,score:.047318,width:.334375,top:.366667,height:.279167,fill:.506905,boxArea:.093346},visualMetrics:{edgeDensity:.075898,upperEdgeDensity:.068906,uniformity:.568646},sceneMetrics:{darkRatio:.76599}},
  {paperGeometry:{usablePaper:false,rectangularPaper:false,score:.26112,width:1,top:.625,height:.375,fill:.696319,boxArea:.375,bottom:1},visualMetrics:{edgeDensity:.233516,upperEdgeDensity:.191771,uniformity:.314271},sceneMetrics:{darkRatio:.141979}},
];
assert.ok(august27Scenes.every((item)=>isLikelyScene(item)));
// 2026-08-28 两张未分类场景的匿名指标：暗场灯阵被金色台阶误成“可用纸张”，
// 白天供水台阶的黄色连通域填充率只比旧阈值低 0.08%。两者都应在 OCR 前
// 进入场景分类，同时不能放宽到下方的真实福单集合。
const august28Scenes=[
  {paperGeometry:{left:0,top:.491667,width:.7125,height:.508333,right:.7125,bottom:1,score:.240521,fill:.664078,boxArea:.362188,rectangularPaper:false,usablePaper:true},visualMetrics:{edgeDensity:.150417,upperEdgeDensity:.078281,uniformity:.475247},sceneMetrics:{luminance:85.5666,warmBrightRatio:.066823,darkRatio:.375833}},
  {paperGeometry:{left:0,top:.3,width:1,height:.7,right:1,bottom:1,score:.419453,fill:.599219,boxArea:.7,rectangularPaper:false,usablePaper:false},visualMetrics:{edgeDensity:.227747,upperEdgeDensity:.201641,uniformity:.333802},sceneMetrics:{luminance:126.7958,warmBrightRatio:.113958,darkRatio:.098125}},
];
// The first altar's colour component is also compatible with a candle-lit
// sheet. Dark/warm metrics alone cannot authorize skipping its code readers.
// Keep the known scene label as a reference, not proof of the heuristic.
assert.equal(isLikelyScene(august28Scenes[0]),false);
assert.equal(isLikelyScene(august28Scenes[1]),true);
const august27Papers=[
  {paperGeometry:{usablePaper:true,rectangularPaper:false,score:.227461,width:.834375,top:.504167,height:.495833,fill:.549806,boxArea:.413711,bottom:1},visualMetrics:{edgeDensity:.202188,upperEdgeDensity:.137773,uniformity:.424102},sceneMetrics:{darkRatio:.411875}},
  {paperGeometry:{usablePaper:true,rectangularPaper:false,score:.223685,width:.89375,top:.5125,height:.4875,fill:.513388,boxArea:.435703,bottom:1},visualMetrics:{edgeDensity:.201172,upperEdgeDensity:.14069,uniformity:.408021},sceneMetrics:{darkRatio:.411406}},
  {paperGeometry:{usablePaper:false,rectangularPaper:false,score:.229922,width:.9625,top:.191667,height:.808333,fill:.295521,boxArea:.778021,bottom:1},visualMetrics:{edgeDensity:.228385,upperEdgeDensity:.145495,uniformity:.420313},sceneMetrics:{darkRatio:.4025}},
  {paperGeometry:{usablePaper:false,rectangularPaper:false,score:.202018,width:.759375,top:.191667,height:.8,fill:.33254,boxArea:.6075,bottom:.991667},visualMetrics:{edgeDensity:.216146,upperEdgeDensity:.135482,uniformity:.430495},sceneMetrics:{darkRatio:.426198}},
  {paperGeometry:{usablePaper:true,rectangularPaper:false,score:.188919,width:.503125,top:.191667,height:.7875,fill:.476815,boxArea:.396211,bottom:.979167},visualMetrics:{edgeDensity:.216602,upperEdgeDensity:.136419,uniformity:.432565},sceneMetrics:{darkRatio:.422552}},
  {paperGeometry:{usablePaper:true,rectangularPaper:false,score:.189583,width:.646875,top:.5125,height:.479167,fill:.611636,boxArea:.309961,bottom:.991667},visualMetrics:{edgeDensity:.182552,upperEdgeDensity:.120417,uniformity:.441354},sceneMetrics:{darkRatio:.487656}},
  {paperGeometry:{usablePaper:false,rectangularPaper:false,score:.193086,width:1,top:.55,height:.45,fill:.42908,boxArea:.45,bottom:1},visualMetrics:{edgeDensity:.226107,upperEdgeDensity:.143294,uniformity:.430495},sceneMetrics:{darkRatio:.329167}},
  {paperGeometry:{usablePaper:true,rectangularPaper:false,score:.167214,width:.76875,top:.529167,height:.470833,fill:.461976,boxArea:.361953,bottom:1},visualMetrics:{edgeDensity:.232982,upperEdgeDensity:.150599,uniformity:.419948},sceneMetrics:{darkRatio:.384063}},
];
assert.ok(august27Papers.every((item)=>!isLikelyScene(item)));
// 2026-08-29 的两张夜间灯阵被金色台阶误识别成宽“可用纸张”。低文字边缘、
// 暖色高光和暗场三项同时成立时应先按场景处理；同批黄纸福单的文字边缘
// 明显更高，不能被这条规则吞掉。
assert.equal(isLikelyScene({
  paperGeometry:{rectangularPaper:false,usablePaper:true,width:.897,height:.633,boxArea:.568},
  visualMetrics:{edgeDensity:.068,upperEdgeDensity:.023,uniformity:.577},
  sceneMetrics:{luminance:91.8,warmBrightRatio:.155,darkRatio:.405},
}),true);
assert.equal(isLikelyScene({
  paperGeometry:{rectangularPaper:false,usablePaper:true,width:.85,height:.45,boxArea:.38},
  visualMetrics:{edgeDensity:.15,upperEdgeDensity:.08,uniformity:.45},
  sceneMetrics:{luminance:79.8,warmBrightRatio:.16,darkRatio:.48},
}),false);
// 2026-08-30 的两张真实夜间灯阵：金色台阶横跨全幅，旧版一张被当作
// “不可读福单”，另一张因误报 usablePaper 也没有进入场景分类。
const august30LampScenes=[
  {paperGeometry:{rectangularPaper:false,usablePaper:false,width:1,height:.692,boxArea:.692,fill:.214},visualMetrics:{edgeDensity:.146,upperEdgeDensity:.070,uniformity:.438},sceneMetrics:{luminance:78.2,warmBrightRatio:.113,darkRatio:.524}},
  {paperGeometry:{rectangularPaper:false,usablePaper:true,width:.956,height:.567,boxArea:.542,fill:.350},visualMetrics:{edgeDensity:.123,upperEdgeDensity:.038,uniformity:.487},sceneMetrics:{luminance:70.5,warmBrightRatio:.111,darkRatio:.575}},
];
assert.ok(august30LampScenes.every((item)=>isLikelyScene(item)));
// 2026-09-01 真实故障的匿名结构回归：两张远景灯阵隔着玻璃拍摄，火焰
// 高光面积很小，墙面红色灯牌又被误成可用纸张。它们必须在 PDF 指纹前
// 归为场景，不能再制造已经占用编号的假冲突。
const september1DistantLampScenes=[
  {paperGeometry:{left:.134375,top:.4375,width:.4125,height:.541667,right:.546875,bottom:.979167,score:.101406,fill:.453846,boxArea:.223438,rectangularPaper:false,usablePaper:true},visualMetrics:{edgeDensity:.089818,upperEdgeDensity:.052995,uniformity:.532474},sceneMetrics:{luminance:56.575,warmBrightRatio:.024948,darkRatio:.693646}},
  {paperGeometry:{left:.153125,top:.379167,width:.75625,height:.45,right:.909375,bottom:.829167,score:.126927,fill:.372972,boxArea:.340313,rectangularPaper:false,usablePaper:true},visualMetrics:{edgeDensity:.092461,upperEdgeDensity:.058477,uniformity:.504583},sceneMetrics:{luminance:53.755,warmBrightRatio:.036615,darkRatio:.698438}},
];
assert.ok(september1DistantLampScenes.every((item)=>isLikelyScene(item)));
// 边缘条件分别保护暗色福单、无暖色火焰的夜景和普通低曝光照片，防止
// 为两张实拍场景放宽成单纯的“图片很暗”。
assert.equal(isLikelyScene({paperGeometry:{rectangularPaper:true,usablePaper:true},visualMetrics:{edgeDensity:.09,upperEdgeDensity:.05,uniformity:.53},sceneMetrics:{luminance:56,darkRatio:.70,warmBrightRatio:.03}}),false);
assert.equal(isLikelyScene({paperGeometry:{rectangularPaper:false,usablePaper:true},visualMetrics:{edgeDensity:.09,upperEdgeDensity:.05,uniformity:.53},sceneMetrics:{luminance:56,darkRatio:.70,warmBrightRatio:.01}}),false);
assert.equal(isLikelyScene({paperGeometry:{rectangularPaper:false,usablePaper:true},visualMetrics:{edgeDensity:.14,upperEdgeDensity:.10,uniformity:.40},sceneMetrics:{luminance:56,darkRatio:.70,warmBrightRatio:.03}}),false);
// 2026-09-02 fourth scene, anonymized: the side-angle lamp image has slightly
// more flame edges than the distant-glass pair but no usable sheet and an even
// more uniform dark background. It must be reported as the third lamp scene,
// not as an unreadable blessing photo. The three controls prevent a dim paper,
// a flame-free night image, or a detailed low-light image from entering it.
const september2ExtraLampScene={paperGeometry:{left:.25625,top:.170833,width:.53125,height:.475,right:.7875,bottom:.645833,score:.07625,fill:.302167,boxArea:.252344,rectangularPaper:false,usablePaper:false},visualMetrics:{edgeDensity:.077344,upperEdgeDensity:.073542,uniformity:.63832},sceneMetrics:{luminance:54.0144,warmBrightRatio:.03401,darkRatio:.681198}};
assert.equal(isLikelyScene(september2ExtraLampScene),true);
assert.equal(isLikelyScene({...september2ExtraLampScene,paperGeometry:{...september2ExtraLampScene.paperGeometry,usablePaper:true}}),false);
assert.equal(isLikelyScene({...september2ExtraLampScene,sceneMetrics:{...september2ExtraLampScene.sceneMetrics,warmBrightRatio:.015}}),false);
assert.equal(isLikelyScene({...september2ExtraLampScene,visualMetrics:{...september2ExtraLampScene.visualMetrics,edgeDensity:.12,uniformity:.50}}),false);
// 2026-09-03 real failure, anonymized: the central stepped water altar formed
// a large bright page-coloured component. It is a scene when no code is read,
// while a full adjacent-line code consensus is conclusive paper evidence and
// must override even deliberately scene-like colour/brightness metrics.
const september3CentralWaterScene={
  paperGeometry:{left:.15,top:.391667,width:.69375,height:.5875,right:.84375,bottom:.979167,score:.239727,fill:.588173,boxArea:.407578,rectangularPaper:false,usablePaper:true},
  visualMetrics:{edgeDensity:.16,upperEdgeDensity:.11,uniformity:.42},
  sceneMetrics:{luminance:125.09,warmBrightRatio:.03,darkRatio:.123},
};
assert.equal(isLikelyScene(september3CentralWaterScene),true);
const directCodeOverScene={...september3CentralWaterScene,reliable:true,number:37,evidence:{method:'paddleocr-onnx-adaptive-right-line-consensus',votes:2,prefixDistance:0,maxConfidence:90}};
assert.equal(hasDirectVisibleCodeEvidence(directCodeOverScene),true);
assert.equal(isLikelyScene(directCodeOverScene),false);

// 同批清晰福单的纸色连通域会把木架也包进去，旧版据此误选“竖版”裁框，
// 并在 y=47.5% 处截到神像底座。新构图的编号实际位于约 y=50%~53%。
const august25Layouts = prioritizedPhotoLayouts({ width: 0.65625, height: 0.875, top: 0.125 }, []);
assert.equal(august25Layouts[0].name, 'current-temple-code-line');
assert.ok(august25Layouts[0].top <= 0.50 && august25Layouts[0].top + august25Layouts[0].height >= 0.53);
// 即使纸色检测误判为窄竖纸，也必须复核 temple 编号行，不能只跑第一种构图。
const falsePortraitLayouts = prioritizedPhotoLayouts({ width: 0.55, height: 0.78, top: 0.12 }, []);
assert.equal(falsePortraitLayouts[0].name, 'current-portrait-code-line');
const falsePortraitTargetedNames=targetedCurrentCodeLayouts(falsePortraitLayouts).map((layout) => layout.name);
assert.equal(falsePortraitTargetedNames[0],'current-portrait-code-line');
assert.ok(['current-temple-code-line','current-outdoor-code-line','current-temple-code-micro',
  'current-temple-upper-code-line','current-temple-lower-code-box-high','current-temple-lower-code-box-low',
  'current-outdoor-upper-code-line']
  .every((name)=>falsePortraitTargetedNames.includes(name)));
const portraitCodeBand=targetedCurrentCodeLayouts(falsePortraitLayouts)[0];
assert.ok(portraitCodeBand.top <= 0.35 && portraitCodeBand.top + portraitCodeBand.height >= 0.41);
const templeMicroLayout=targetedCurrentCodeLayouts(falsePortraitLayouts).find((layout)=>layout.name==='current-temple-code-micro');
assert.ok(templeMicroLayout.top <= 0.50 && templeMicroLayout.top + templeMicroLayout.height >= 0.53);
// 2026-08-26 真实故障的脱敏构图回归：纸张定位正确，但提速后的固定四框
// 没覆盖纸内上方编号行。纸张相对窄框必须先于固定相机框参与有限复核。
const august26Geometry={left:0.171875,top:0.15,width:0.828125,height:0.7041666667,right:1,bottom:0.8541666667,usablePaper:true,rectangularPaper:false};
const august26Layouts=prioritizedPhotoLayouts(august26Geometry,[
  {name:'paper-relative-landscape-code-upper-right',left:0.743,top:0.220,width:0.190,height:0.046},
  {name:'paper-relative-landscape-code-lower-right',left:0.734,top:0.344,width:0.149,height:0.023},
]);
assert.deepEqual(targetedCurrentCodeLayouts(august26Layouts).slice(0,2).map((layout)=>layout.name),[
  'paper-relative-landscape-code-upper-right',
  'paper-relative-landscape-code-lower-right',
]);
assert.ok(targetedCurrentCodeLayouts(august26Layouts)[0].top <= 0.23);
assert.ok(targetedCurrentCodeLayouts(august26Layouts)[0].height >= 0.04);
// 2026-08-28 脱敏构图回归：供水福单的纸色与木架/神像相连，动态纸框
// 几乎覆盖整幅照片，真实编号稳定落在画面 y=56%~59%。固定候选必须独立
// 覆盖这条编号带，不能继续相信错误的纸框顶边。
const august28WaterLayouts=targetedCurrentCodeLayouts(prioritizedPhotoLayouts({
  left:.265625,top:.008333,width:.6125,height:.9875,right:.878125,bottom:.995833,
  score:.298568,fill:.493628,boxArea:.604844,usablePaper:true,rectangularPaper:false,
},[]));
assert.ok(august28WaterLayouts.some((layout)=>layout.left<=.68
  && layout.left+layout.width>=.74 && layout.top<=.58 && layout.top+layout.height>=.59));
assert.ok(august28WaterLayouts.some((layout)=>layout.name==='current-temple-lower-code-box-high'
  && layout.top<=.54 && layout.top+layout.height>=.59));
assert.ok(august28WaterLayouts.some((layout)=>layout.name==='current-temple-lower-code-box-low'
  && layout.top<=.58 && layout.top+layout.height>=.61));
// 同日供灯福单编号位于 y=41%~45%，必须有一个严格小框覆盖；宽达 14% 的
// portrait 回退框会带入标题和花边，实测无法形成 OCR 共识。
const august28LampLayouts=targetedCurrentCodeLayouts(prioritizedPhotoLayouts({
  left:.159375,top:.4,width:.825,height:.508333,right:.984375,bottom:.908333,
  score:.236549,fill:.564052,boxArea:.419375,usablePaper:true,rectangularPaper:false,
},[]));
assert.ok(august28LampLayouts.some((layout)=>layout.left<=.65
  && layout.left+layout.width>=.73 && layout.top<=.42 && layout.top+layout.height>=.43
  && layout.height<=.08));
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
// 2026-08-26 单张场景补图回归：旧版在视觉分类前硬性要求至少两张，导致
// 清晰供水补图永远停在人工队列。以下匿名指标来自当天真实供水/供灯画面。
assert.equal(classifySceneVisualScore({luminance:133.0394,warmBrightRatio:0.2260,darkRatio:0.0750}),'scene-water');
assert.equal(classifySceneVisualScore({luminance:92.7817,warmBrightRatio:0.1807,darkRatio:0.3788}),'scene-lamp');
// 2026-08-28 的第二张灯阵曝光更低，暖色高光面积只有 6.7%，但暗像素 37.6%、
// 整体亮度 85.6，仍是明确灯阵；供水全景保持由低暗像素和高亮度识别。
assert.equal(classifySceneVisualScore({luminance:85.5666,warmBrightRatio:.066823,darkRatio:.375833}),'scene-lamp');
assert.equal(classifySceneVisualScore({luminance:126.7958,warmBrightRatio:.113958,darkRatio:.098125}),'scene-water');
// 2026-08-30 顶棚阴影下的供水全景，比旧阈值稍暗但暖色高光很少。
assert.equal(classifySceneVisualScore({luminance:106.4,warmBrightRatio:.058,darkRatio:.222}),'scene-water');
assert.equal(classifySceneVisualScore({luminance:102,warmBrightRatio:0.04,darkRatio:0.20}),null);
assert.equal(classifySceneVisualScore({luminance:56.575,warmBrightRatio:.024948,darkRatio:.693646}),'scene-lamp');
assert.equal(classifySceneVisualScore({luminance:53.755,warmBrightRatio:.036615,darkRatio:.698438}),'scene-lamp');
assert.equal(classifySceneVisualScore({luminance:56,warmBrightRatio:.01,darkRatio:.70}),null);
// 自适应右侧编号带必须分别以两个重叠窗口覆盖 y≈30% 和 y≈57% 的编号，
// 防止未来再次通过追加某一天的固定坐标修复清晰编号。
for (const y of [.30,.57]) {
  assert.ok(OVERLAPPING_RIGHT_CODE_BANDS.filter((layout)=>layout.top<=y && layout.top+layout.height>=y+.015).length>=2);
}
const singleWaterFile=path.join(sameKindSceneRoot,'single-water.jpg');
await sharp(Buffer.from('<svg width="160" height="120" xmlns="http://www.w3.org/2000/svg"><rect width="160" height="120" fill="#d8c7a0"/><g fill="#d7a536"><circle cx="30" cy="70" r="12"/><circle cx="70" cy="70" r="12"/><circle cx="110" cy="70" r="12"/></g></svg>')).jpeg({quality:92}).toFile(singleWaterFile);
const singleWaterResult=await classifyScenes([singleWaterFile],new Set());
assert.equal(singleWaterResult.issues.length,0);
assert.deepEqual(singleWaterResult.assignments.map((item)=>[item.targetName,item.kind]),[['2.5.jpg','scene-water']]);
const singleLampResult=await classifyScenes([sameKindLampScenes[0]],new Set());
assert.equal(singleLampResult.issues.length,0);
assert.deepEqual(singleLampResult.assignments.map((item)=>[item.targetName,item.kind]),[['2.1.jpg','scene-lamp']]);
const ambiguousSceneFile=path.join(sameKindSceneRoot,'single-ambiguous.jpg');
await sharp(Buffer.from('<svg width="160" height="120" xmlns="http://www.w3.org/2000/svg"><rect width="160" height="120" fill="#666666"/></svg>')).jpeg({quality:92}).toFile(ambiguousSceneFile);
const ambiguousSingleResult=await classifyScenes([ambiguousSceneFile],new Set());
assert.equal(ambiguousSingleResult.assignments.length,0);
assert.match(ambiguousSingleResult.issues[0],/单图视觉证据不足/);
const occupiedLampResult=await classifyScenes([ambiguousSceneFile],new Set(['2.1.jpg','2.2.jpg']));
assert.equal(occupiedLampResult.assignments.length,0);
assert.match(occupiedLampResult.issues[0],/单图视觉证据不足/);
fs.rmSync(sameKindSceneRoot,{recursive:true,force:true});
const globallyAmbiguousPhotos=[
  {file:'actual-466.jpg',reliable:false,number:null,paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{},candidates:[{number:466,votes:2,prefixDistance:2.2},{number:468,votes:2,prefixDistance:2.3}]},
  {file:'actual-468.jpg',reliable:true,number:468,paperGeometry:{usablePaper:true},visualMetrics:{},candidates:[]},
];
assert.deepEqual(resolveAmbiguousPhotosByGlobalSet(globallyAmbiguousPhotos,new Set([466,467,468]),new Set([467])).map((item)=>item.to),[466]);
const competingAmbiguousPhotos=[0,1].map((index)=>({file:`candidate-${index}.jpg`,reliable:false,number:null,paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{},candidates:[{number:466,votes:2,prefixDistance:2.2}]}));
assert.deepEqual(resolveAmbiguousPhotosByGlobalSet(competingAmbiguousPhotos,new Set([466]),new Set()),[]);
const exactSingleVotePhoto=[{file:'actual-580.jpg',reliable:false,number:null,paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{},candidates:[{number:580,votes:1,prefixDistance:0,maxConfidence:29}]}];
assert.deepEqual(resolveAmbiguousPhotosByGlobalSet(exactSingleVotePhoto,new Set([579,580]),new Set([579])).map((item)=>item.to),[580]);
const weakSingleVotePhoto=[{file:'weak-580.jpg',reliable:false,number:null,paperGeometry:{usablePaper:true,rectangularPaper:true},visualMetrics:{},candidates:[{number:580,votes:1,prefixDistance:0,maxConfidence:9}]}];
assert.deepEqual(resolveAmbiguousPhotosByGlobalSet(weakSingleVotePhoto,new Set([580]),new Set()),[]);
assert.match(runnerSource,/schemaVersion:2[\s\S]*stage:'not-started'/);
assert.match(runnerSource,/needsOnlineRetryCheck[\s\S]*queryPdfBoundPhotoUploadState/);
assert.match(runnerSource,/本地已有 \$\{Object\.keys\(uploadedFiles\)\.length\} 张回执/);
assert.match(runnerSource,/post-upload-order-set-reconciled/);
assert.match(runnerSource,/queryNotUploadedOrders/);
assert.match(runnerSource,/pdf-bound-order-set-all-uploaded/);
assert.match(runnerSource,/线上订单集合复核通过/);
assert.match(runnerSource,/online-order-set-partial-stop/);
assert.match(runnerSource,/订单与纸张照片不是一对一关系/);
assert.match(runnerSource,/pendingFiles = manifest\.files\.blessing\.filter/);
assert.doesNotMatch(runnerSource,/程序不会自动重传，请先人工核对/);
assert.match(siteSource,/queryOrdersByBlessingUploadStatus/);
assert.match(siteSource,/allStates/);
assert.match(siteSource,/queryUploadedTabletPhotoOrders/);
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
const localOcrAssets=verifyLocalOcrAssets(process.cwd());
assert.equal(localOcrAssets.available,process.platform==='win32' && process.arch==='x64');
if(localOcrAssets.available){
  assert.equal(localOcrAssets.modelSha256,'70b2450eed39599af6b996c27a2f1a0ef30eeb49f9f66dd3e74f28f652befc89');
  const portableOcrSmoke=path.join(dir,'portable-ocr-smoke.png');
  await sharp({
    text:{text:'268-1-631',font:'Arial',width:900,height:120,rgba:true,align:'centre'},
  }).flatten({background:'white'}).png().toFile(portableOcrSmoke);
  const portableOcrResult=await recognizeLocalTextLine(process.cwd(),portableOcrSmoke);
  assert.equal(typeof portableOcrResult.text,'string');
  assert.ok(Number.isFinite(portableOcrResult.confidence));
}
const fakeDictionary=['0','1','2'];
const fakeProbabilities=new Float32Array(5*5);
for(const [step,index] of [0,1,1,2,4].entries()) fakeProbabilities[step*5+index]=1;
assert.deepEqual(decodePaddleCtc({dims:[1,5,5],data:fakeProbabilities},fakeDictionary),{text:'01 ',confidence:1});
const localExpectedNumbers=new Set(Array.from({length:15},(_,index)=>630+index));
assert.deepEqual(parseLocalOcrCodeCandidates('631','268',localExpectedNumbers).map((item)=>item.number),[631]);
assert.deepEqual(new Set(parseLocalOcrCodeCandidates('268-1-6317','268',localExpectedNumbers).map((item)=>item.number)),new Set([631,637]));
assert.deepEqual(parseLocalOcrCodeCandidates('20260830','268',localExpectedNumbers),[]);
assert.match(localOcrCodeLayoutsForPhoto({top:0.54,right:1})[0].name,/local-ocr-grid0-line/);
assert.match(localOcrCodeLayoutsForPhoto({top:0.54,right:1})[1].name,/local-ocr-grid1-line/);
assert.match(localOcrCodeLayoutsForPhoto({top:0.20,right:0.91})[0].name,/local-ocr-grid0-line/);
assert.equal(localOcrCodeLayoutsForPhoto({top:0.20,right:0.91}).length,874);
assert.equal(hasAdjacentLocalOcrConsensus([
  {number:35,variant:'local-ocr-center-line-52:color',prefixDistance:0,confidence:94},
  {number:35,variant:'local-ocr-center-line-52:normalized',prefixDistance:0,confidence:88},
],35),true);
assert.equal(hasAdjacentLocalOcrConsensus([
  {number:35,variant:'local-ocr-center-line-52:color',prefixDistance:0,confidence:94},
],35),false);
assert.equal(hasAdjacentLocalOcrConsensus([
  {number:31,variant:'local-ocr-left-line-100:color',prefixDistance:0,confidence:91},
  {number:31,variant:'local-ocr-left-line-102:color',prefixDistance:0,confidence:64},
],31),true);
assert.match(photoPrepareSource,/const secondPassLayouts = layouts\.slice\(0, 2\)/);
assert.match(photoPrepareSource,/const contrastChannels = \[null\]/);
assert.match(photoPrepareSource,/const thresholds = \[110, 170\]/);
assert.match(photoPrepareSource,/fe23635e245f646c0b27ac6c9268453738dbbdd6157d9d03bf9d5c78cff870e7/);
assert.match(photoPrepareSource,/微信图片_20260814123729_7475_139\.jpg': 284/);
assert.match(photoPrepareSource,/微信图片_20260814123737_7484_139\.jpg': '2\.5\.jpg'/);
assert.match(photoPrepareSource,/微信图片_20260814123735_7482_139\.jpg': 287/);
assert.match(photoPrepareSource,/targeted-landscape-code-threshold-consensus/);
assert.match(photoPrepareSource,/const thresholds = \[110, 170\]/);
assert.match(photoPrepareSource,/paper-relative-code-only[\s\S]*paper-relative-landscape-code-upper-right/);
assert.match(photoPrepareSource,/resize\(\{ width: 1600, withoutEnlargement: false \}\)/);
assert.match(photoPrepareSource,/prioritizedPhotoLayouts/);
assert.equal(parseWindowsOcrTail('26 卜 355'),355);
assert.equal(parseWindowsOcrTail('编号: 268-1-363'),363);
assert.equal(parseWindowsOcrTail('no usable number'),null);
fs.rmSync(dir,{recursive:true,force:true});
console.log('tests passed');
