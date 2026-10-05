// Synthetic duplicate correction through the production uploader and a routed
// headless Edge page. No real backend, business pictures or saved profile.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {PrayerSite} from '../src/site.mjs';
import {retainManualPhotoAttemptEvidence,retainManualUploadRetryState} from '../src/workflow-state.mjs';
import {
  prepareManualUploadCorrectionReview,approveManualUploadCorrection,
  markManualUploadCorrectionSubmitted,confirmManualUploadCorrection,
  retainManualUploadCorrectionState,
} from '../src/manual-upload-correction.mjs';

const require=createRequire(import.meta.url),sharp=require('sharp'),{chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-correction-browser-'));
const receiptPath=path.join(temp,'upload-receipt.json');
const businessDate='2026-10-02',now='2026-10-05T03:00:00.000Z';
const pendingRows=[{kind:'lamp',id:'local-order-1'},{kind:'tablet',id:'local-order-2'}];
const pendingOrderIdHash=crypto.createHash('sha256').update(pendingRows.map(row=>`${row.kind}:${row.id}`).sort().join('\n')).digest('hex');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  for(const [name,color] of [['11.jpg','#aa3355'],['12.jpg','#55bbcc']]) {
    await sharp({create:{width:1800,height:1350,channels:3,background:color}}).jpeg().toFile(path.join(temp,name));
  }
  const currentFiles=['11.jpg','12.jpg'];
  const currentFileHashes=Object.fromEntries(currentFiles.map(name=>[name,hash(path.join(temp,name))]));
  const oldFileHashes={...currentFileHashes,'111.jpg':currentFileHashes['11.jpg']};
  const oldFiles=['11.jpg','111.jpg','12.jpg'];
  const preparationReceipt={businessDate,completedAt:'2026-10-02T02:00:00.000Z',
    files:oldFiles.map(targetName=>({targetName,kind:'blessing',afterSha256:oldFileHashes[targetName]}))};
  let receipt={businessDate,complete:false,uncertainSubmission:true,uncertainRetryCount:1,
    uploadedFiles:{},uploadedCount:0,fileSetHash:'old-scene',stage:'transport-response',
    currentBatch:1,currentBatchFiles:oldFiles,currentBatchFileHashes:oldFileHashes,
    currentBatchStartedAt:'2026-10-02T03:00:00.000Z',currentBatchSubmissionStage:'transport-response',
    currentBatchPendingOrderIdHash:pendingOrderIdHash,currentBatchPendingOrderCount:pendingRows.length,
    currentBatchTransportRequestSeen:true,currentBatchTransportResponseSeen:true,currentBatchUploadCount:null,
    currentBatchUploadEvidence:{requestStarted:true,responseSeen:true}};
  const persist=()=>{
    fs.writeFileSync(receiptPath+'.tmp',JSON.stringify(receipt));
    fs.renameSync(receiptPath+'.tmp',receiptPath);
  };
  const read=()=>JSON.parse(fs.readFileSync(receiptPath,'utf8'));
  const reviewNow=()=>prepareManualUploadCorrectionReview({businessDate,receipt,currentFiles,currentFileHashes,
    preparationReceipt,firstOnline:{uploadedCount:0,pendingRows},secondOnline:{uploadedCount:0,pendingRows},now});
  const restart=scene=>{
    const saved=read();
    receipt={businessDate,complete:false,uncertainSubmission:saved.uncertainSubmission,
      uploadedFiles:saved.uploadedFiles,uploadedCount:saved.uploadedCount,
      stage:'not-started',fileSetHash:scene,previousAttempt:retainManualPhotoAttemptEvidence(saved),
      ...retainManualUploadRetryState(saved),...retainManualUploadCorrectionState(saved)};
    persist();
  };
  persist();
  const firstReview=reviewNow();
  assert.equal(firstReview.eligible,true);
  assert.deepEqual(firstReview.removedFiles,[{name:'111.jpg',duplicateOf:'11.jpg',sha256:currentFileHashes['11.jpg']}]);
  assert.equal(firstReview.oldUncertainRetryCount,1);
  const correctionId=firstReview.correctionId;
  let posts=0,mode='missing-month-button',diskAtPost;
  const page=await browser.newPage(),site=new PrayerSite(temp,{count(){}},()=>{});
  site.page=page;site.tempRoot=temp;site.uploadResultTimeoutMs=1500;
  page.on('dialog',async dialog=>{site.dialogs.push(dialog.message());await dialog.accept()});
  await page.route('**/*',async route=>{
    const request=route.request();
    assert.equal(new URL(request.url()).host,'correction.test','production network must never be used');
    if(request.method()==='POST') {
      posts++;
      diskAtPost=read();
      assert.equal(diskAtPost.uncertainRetryCount,1,'a correction does not reset the old retry budget');
      assert.equal(diskAtPost.correctedAttempts[correctionId].status,'submitting','save the correction submit boundary before POST');
      assert.equal(diskAtPost.correctedAttempts[correctionId].submissionStage,'month-submit-started');
      assert.equal(diskAtPost.correctedAttempts[correctionId].oldReceipt.uncertainRetryCount,1);
      assert.deepEqual(diskAtPost.currentBatchFileHashes,currentFileHashes);
      assert.match(request.postData()||'',/11\.jpg/);
      assert.match(request.postData()||'',/12\.jpg/);
      assert.doesNotMatch(request.postData()||'',/111\.jpg/);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({result:{state:1,message:'成功'}})});
    }
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`
      <input id="file" type="file" multiple onchange="showMonth()">
      <form id="form"><button type="button" onclick="document.querySelector('#file').click()"><i class="fa-camera"></i></button></form>
      <script>
      function showMonth(){const d=document.createElement('div');d.className='layui-layer';d.innerHTML='<input id="years">'+(${mode==='missing-month-button'}?'':'<a class="layui-layer-btn0">确定</a>');document.body.append(d);const button=d.querySelector('a');if(button)button.onclick=async()=>{const month=d.querySelector('input').value;d.remove();if(!confirm('确认要上传吗？'))return;const data=new FormData();data.append('years',month);for(const file of document.querySelector('#file').files)data.append('file',file);const result=await fetch('/blessing/mind/uploadPic/name',{method:'POST',body:data}).then(r=>r.json());const message=document.createElement('div');message.className='layui-layer layui-layer-msg';message.innerHTML='<div class="layui-layer-content">'+result.result.message+'</div>';document.body.append(message)}}
      </script>`});
  });
  site.openImageProcessing=async()=>{await page.goto('http://correction.test/upload')};
  const submitApproved=async()=>{
    assert.equal(receipt.correctedAttempts?.[correctionId]?.status,'approved','the upload caller requires an approved correction');
    receipt.previousAttempt=retainManualPhotoAttemptEvidence(receipt);
    Object.assign(receipt,{currentBatch:1,currentBatchFiles:[...currentFiles],currentBatchFileHashes:{...currentFileHashes},
      currentBatchStartedAt:now,currentBatchSubmissionStage:null,currentBatchTransportRequestSeen:false,
      currentBatchTransportResponseSeen:false,currentBatchUploadEvidence:null,currentBatchUploadCount:null});
    persist();
    return site.uploadBlessingBatch(currentFiles.map(name=>path.join(temp,name)),businessDate,(stage,detail)=>{
      markManualUploadCorrectionSubmitted(receipt,correctionId,stage,{now});
      receipt.stage=stage;
      if(receipt.correctedAttempts[correctionId].status==='submitting')receipt.currentBatchSubmissionStage=stage;
      if(stage==='transport-request')receipt.currentBatchTransportRequestSeen=true;
      if(stage==='transport-response')receipt.currentBatchTransportResponseSeen=true;
      if(stage==='transport-outcome')receipt.currentBatchTransportOutcome=detail;
      persist();
    });
  };

  assert.throws(()=>approveManualUploadCorrection(receipt,firstReview,{confirmationToken:firstReview.confirmationToken,now}),/人工确认|未授权/);
  assert.throws(()=>approveManualUploadCorrection(receipt,firstReview,{confirmationToken:'wrong-token',confirmed:true,now}),/人工确认|未授权/);
  await assert.rejects(submitApproved(),/requires an approved correction/);
  assert.equal(posts,0);
  approveManualUploadCorrection(receipt,firstReview,{confirmationToken:firstReview.confirmationToken,confirmed:true,now});
  persist();
  await assert.rejects(submitApproved(),/月份窗口没有识别到确定按钮/);
  assert.equal(await page.locator('#file').evaluate(input=>input.files.length),2);
  assert.equal(posts,0,'file selection with no submit button does not send a correction');
  assert.equal(read().correctedAttempts[correctionId].status,'approved');
  for(let refresh=0;refresh<2;refresh++) {
    restart(`scene-before-post-${refresh}`);
    assert.deepEqual(receipt.currentBatchFileHashes,currentFileHashes,'new current-batch hashes survive re-entry');
    assert.deepEqual(receipt.correctedAttempts[correctionId].oldReceipt.currentBatchFileHashes,oldFileHashes,'old duplicate hashes remain bound to the old attempt');
    const fresh=reviewNow();
    assert.equal(fresh.eligible,true);
    assert.equal(fresh.correctionId,correctionId);
    approveManualUploadCorrection(receipt,fresh,{confirmationToken:fresh.confirmationToken,confirmed:true,now});
    assert.equal(receipt.uncertainRetryCount,1);
    persist();
  }

  mode='success-without-count';
  await assert.rejects(submitApproved(),error=>{
    assert.equal(error.code,'BLESSING_UPLOAD_OUTCOME_UNCONFIRMED');
    assert.equal(error.uploadEvidence.requestStarted,true);
    assert.equal(error.uploadEvidence.responseSeen,true);
    assert.equal(error.uploadEvidence.applicationSuccess,true);
    receipt.currentBatchUploadEvidence=error.uploadEvidence;
    receipt.stage='manual-photo-online-image-readback-incomplete';
    persist();
    return true;
  });
  assert.equal(posts,1);
  assert.ok(diskAtPost);
  const submitted=read();
  for(let refresh=0;refresh<3;refresh++) {
    restart(`scene-after-post-${refresh}`);
    assert.equal(receipt.correctedAttempts[correctionId].status,'submitting');
    assert.equal(receipt.uncertainRetryCount,1);
    assert.deepEqual(receipt.currentBatchFileHashes,currentFileHashes);
    assert.deepEqual(receipt.previousAttempt.fileHashes,currentFileHashes,'attempt identity retains the exact submitted hashes');
    assert.deepEqual(receipt.currentBatchUploadEvidence,submitted.currentBatchUploadEvidence);
    assert.deepEqual(receipt.correctedAttempts[correctionId].oldReceipt.currentBatchFileHashes,oldFileHashes);
    assert.equal(reviewNow().eligible,false,'an uncertain corrected POST cannot create a new review');
    assert.throws(()=>approveManualUploadCorrection(receipt,firstReview,{confirmationToken:firstReview.confirmationToken,confirmed:true,now}),/确认|授权|提交/);
    await assert.rejects(submitApproved(),/requires an approved correction/);
  }
  assert.throws(()=>confirmManualUploadCorrection(receipt,correctionId,{uploadedFileHashes:{'11.jpg':currentFileHashes['11.jpg']},now}),/逐文件上传凭据/);
  assert.equal(receipt.correctedAttempts[correctionId].status,'submitting');
  assert.equal(posts,1);
  await page.close();
  console.log('Manual upload correction browser PASS: explicit confirmation, preparatory failure resume, one corrected POST, old budget/history and exact file hashes survive restart');
} finally {
  await browser.close();
  const actual=fs.realpathSync(temp),parent=fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(actual).toLowerCase(),parent.toLowerCase());
  assert.ok(path.basename(actual).startsWith('qifu-correction-browser-'));
  fs.rmSync(actual,{recursive:true,force:true});
}
