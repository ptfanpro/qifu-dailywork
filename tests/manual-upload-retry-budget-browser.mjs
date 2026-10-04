// Real headless Edge, synthetic images and a routed local page only. Verify
// retry reservations against the production uploader's actual submit boundary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {PrayerSite} from '../src/site.mjs';
import {
  decideManualPhotoUncertainRetry,
  retainManualPhotoAttemptEvidence,
  retainManualUploadRetryState,
  reserveManualUploadRetry,
  markManualUploadRetrySubmitted,
} from '../src/workflow-state.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require('playwright'),sharp=require('sharp');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-retry-budget-browser-'));
const receiptPath=path.join(temp,'upload-receipt.json');
const now='2026-10-05T03:00:00.000Z';
const rows=[{kind:'lamp',id:'fixture-order-1'},{kind:'tablet',id:'fixture-order-2'}];
const originalAttempt={stage:'month-submitted',files:['11.jpg'],
  startedAt:'2026-10-02T03:00:00.000Z',pendingOrderIdHash:null,pendingOrderCount:null,uploadedCount:null};
let receipt={complete:false,fileSetHash:'original-scene',uncertainSubmission:true,
  uncertainRetryCount:0,previousAttempt:structuredClone(originalAttempt)};
const persist=()=>{
  const temporary=receiptPath+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify(receipt));
  fs.renameSync(temporary,receiptPath);
};
const read=()=>JSON.parse(fs.readFileSync(receiptPath,'utf8'));
const recovery=()=>decideManualPhotoUncertainRetry({
  blessingCount:1,verifiedReceiptCount:0,pendingFiles:['11.jpg'],
  previousAttempt:receipt.previousAttempt,uncertainRetryCount:receipt.uncertainRetryCount,
  onlineUploadedCount:0,secondOnlineUploadedCount:0,
  firstPendingRows:rows,secondPendingRows:rows,now,
});
const restart=(sceneHash)=>{
  const saved=read();
  receipt={complete:false,fileSetHash:sceneHash,stage:'not-started',
    uncertainSubmission:saved.uncertainSubmission===true,
    previousAttempt:retainManualPhotoAttemptEvidence(saved),
    ...retainManualUploadRetryState(saved)};
  persist();
};
const reserve=()=>{
  const decision=recovery();
  assert.equal(decision.allowed,true,'only the existing two-snapshot guard may reserve a retry');
  reserveManualUploadRetry(receipt,decision,{now});
  assert.equal(receipt.uncertainRetryCount,0,'reserving permission is not submitting a photo');
  assert.equal(receipt.uncertainRetryEvidence.status,'reserved');
  persist();
};
const prepareAttempt=()=>{
  Object.assign(receipt,{currentBatch:1,currentBatchFiles:['11.jpg'],
    currentBatchStartedAt:now,currentBatchPendingOrderIdHash:receipt.uncertainRetryEvidence.pendingOrderIdHash,
    currentBatchPendingOrderCount:rows.length,currentBatchSubmissionStage:null,
    currentBatchTransportRequestSeen:false,currentBatchTransportResponseSeen:false,
    currentBatchTransportStatus:null,currentBatchTransportOutcome:null,
    currentBatchUploadCount:null,currentBatchUploadEvidence:null});
  persist();
};
const onStage=(stage,detail)=>{
  markManualUploadRetrySubmitted(receipt,stage);
  receipt.stage=stage;
  if (receipt.uncertainRetryEvidence.status==='possibly-submitted') {
    receipt.uncertainSubmission=true;
    receipt.currentBatchSubmissionStage=stage;
  }
  if(stage==='transport-request') receipt.currentBatchTransportRequestSeen=true;
  if(stage==='transport-response') {
    receipt.currentBatchTransportResponseSeen=true;
    receipt.currentBatchTransportStatus=detail?.status??null;
  }
  if(stage==='transport-outcome') receipt.currentBatchTransportOutcome=detail;
  // Like runner.mjs, persist synchronously before PrayerSite may click the
  // month button. The fixture POST handler reads this actual disk checkpoint.
  persist();
};

const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const photo=path.join(temp,'11.jpg');
  await sharp({create:{width:1800,height:1350,channels:3,background:'#abcabc'}}).jpeg().toFile(photo);
  const page=await browser.newPage();
  const site=new PrayerSite(temp,{count(){}},()=>{});
  site.page=page;site.tempRoot=temp;site.uploadResultTimeoutMs=1500;
  let posts=0,mode='missing-month-button',checkpointBeforePost;
  page.on('dialog',async dialog=>{site.dialogs.push(dialog.message());await dialog.accept()});
  await page.route('**/*',async route=>{
    const request=route.request();
    assert.equal(new URL(request.url()).host,'retry-budget.test','no real backend is accessible');
    if(request.method()==='POST') {
      posts++;
      checkpointBeforePost=read();
      assert.equal(checkpointBeforePost.uncertainRetryCount,1,'budget must be durable before a POST');
      assert.equal(checkpointBeforePost.uncertainRetryEvidence.status,'possibly-submitted');
      assert.equal(checkpointBeforePost.uncertainRetryEvidence.submissionStage,'month-submit-started');
      assert.match(request.postData()||'',/202610/);
      assert.match(request.postData()||'',/11\.jpg/);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({result:{state:0,message:'上传失败'}})});
    }
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`
      <input id="file" type="file" multiple onchange="showMonth()">
      <form id="form"><button type="button" onclick="document.querySelector('#file').click()"><i class="fa-camera"></i></button></form>
      <script>
      function showMonth(){const d=document.createElement('div');d.className='layui-layer';d.innerHTML='<input id="years">'+(${mode==='missing-month-button'}?'':'<a class="layui-layer-btn0">确定</a>');document.body.append(d);const button=d.querySelector('a');if(button)button.onclick=async()=>{const month=d.querySelector('input').value;d.remove();if(!confirm('确认要上传吗？'))return;const data=new FormData();data.append('years',month);for(const file of document.querySelector('#file').files)data.append('file',file);const result=await fetch('/blessing/mind/uploadPic/name',{method:'POST',body:data}).then(r=>r.json());const message=document.createElement('div');message.className='layui-layer layui-layer-msg';message.innerHTML='<div class="layui-layer-content">'+result.result.message+'</div>';document.body.append(message)}}
      </script>`});
  });
  site.openImageProcessing=async()=>{await page.goto('http://retry-budget.test/upload')};

  persist();
  reserve();
  // A local copy can fail before any browser upload interaction. Restarting
  // that attempt must not convert its reservation into a used retry.
  prepareAttempt();
  await assert.rejects(site.uploadBlessingBatch([path.join(temp,'missing','11.jpg')],'2026-10-02',onStage),
    error=>error.code==='ENOENT');
  assert.equal(posts,0);
  assert.equal(read().uncertainRetryCount,0);
  restart('scene-after-copy-failure');
  assert.deepEqual(receipt.uncertainRetryEvidence.originalAttempt,originalAttempt);
  assert.equal(recovery().allowed,true);

  reserve();
  prepareAttempt();
  await assert.rejects(site.uploadBlessingBatch([photo],'2026-10-02',onStage),/月份窗口没有识别到确定按钮/);
  assert.equal(await page.locator('#file').evaluate(input=>input.files.length),1,'the real chooser selected the staged photo');
  assert.equal(posts,0,'selecting a file is not a submission');
  assert.equal(read().uncertainRetryCount,0);
  for(let refresh=0;refresh<3;refresh++) {
    restart(`changed-scene-${refresh}`);
    assert.equal(receipt.uncertainRetryCount,0,'read-only re-entry cannot consume a reservation');
    assert.deepEqual(receipt.uncertainRetryEvidence.originalAttempt,originalAttempt);
    assert.equal(recovery().allowed,true);
  }

  reserve();
  prepareAttempt();
  mode='post-failure';
  await assert.rejects(site.uploadBlessingBatch([photo],'2026-10-02',onStage),error=>{
    assert.equal(error.code,'BLESSING_UPLOAD_OUTCOME_UNCONFIRMED');
    assert.equal(error.uploadEvidence.requestStarted,true);
    assert.equal(error.uploadEvidence.responseSeen,true);
    assert.equal(error.uploadEvidence.applicationFailure,true);
    receipt.currentBatchUploadEvidence=error.uploadEvidence;
    receipt.stage='manual-photo-retry-evidence-conflict';
    persist();
    return true;
  });
  assert.equal(posts,1,'one reserved retry may issue exactly one POST');
  assert.ok(checkpointBeforePost);
  const submitted=read();
  assert.equal(submitted.uncertainRetryCount,1);
  assert.equal(submitted.currentBatchTransportRequestSeen,true);
  assert.equal(submitted.currentBatchTransportResponseSeen,true);
  assert.equal(submitted.currentBatchUploadEvidence.responseOutcomes[0].category,'business-failure');
  for(let refresh=0;refresh<3;refresh++) {
    restart(`scene-after-real-post-${refresh}`);
    assert.equal(receipt.uncertainRetryCount,1,'neither failure nor scene edits grant another uncertain POST');
    assert.equal(recovery().allowed,false);
    for(const key of ['currentBatchFiles','currentBatchStartedAt','currentBatchPendingOrderIdHash',
      'currentBatchPendingOrderCount','currentBatchSubmissionStage','currentBatchTransportRequestSeen',
      'currentBatchTransportResponseSeen','currentBatchTransportStatus','currentBatchTransportOutcome',
      'currentBatchUploadEvidence','uncertainRetryEvidence']) {
      assert.deepEqual(receipt[key],submitted[key],`restart must preserve ${key} for this exact attempt`);
    }
  }
  assert.equal(posts,1);
  await page.close();
  console.log('Manual upload retry budget browser PASS: copy/chooser failures preserve reservation; disk checkpoint precedes POST; failure/refresh/scene changes preserve consumed budget and evidence');
} finally {
  await browser.close();
  const actual=fs.realpathSync(temp),parent=fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(actual).toLowerCase(),parent.toLowerCase());
  assert.ok(path.basename(actual).startsWith('qifu-retry-budget-browser-'));
  fs.rmSync(actual,{recursive:true,force:true});
}
