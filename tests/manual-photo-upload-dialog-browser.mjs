// Local browser fixture only: no production data or network mutations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {PrayerSite,scheduleSiteClick} from '../src/site.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const sharp=require('sharp');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prayer-upload-confirm-'));
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const timerPage=await browser.newPage();
  await timerPage.setContent('<button onclick="window.clicks=(window.clicks||0)+1">click</button>');
  await timerPage.evaluate(()=>{window.setTimeout=()=>0});
  await scheduleSiteClick(timerPage.locator('button'));
  await timerPage.waitForFunction(()=>window.clicks===1,null,{timeout:2000});
  await timerPage.close();
  const file=path.join(temp,'487.jpg');
  await sharp({create:{width:1800,height:1350,channels:3,background:'#ececec'}}).jpeg().toFile(file);
  const batchFiles=[file];
  for(let index=1;index<12;index++) {
    const next=path.join(temp,`${487+index}.jpg`);
    fs.copyFileSync(file,next);batchFiles.push(next);
  }
  for(const {delay,success,noConfirm,count=1,payload,expectedOutcome,postAlert=false} of [
    {delay:0,success:true},{delay:5500,success:true},{delay:0,success:false},{delay:0,success:false,noConfirm:true},
    {delay:0,success:false,count:12,payload:{result:{state:1,message:'成功'}},expectedOutcome:'success-without-count'},
    {delay:0,success:false,count:12,payload:{result:{state:0,message:'12'}},expectedOutcome:'business-failure'},
    {delay:0,success:false,count:12,payload:{result:{state:0,message:'上传失败'}},expectedOutcome:'business-failure',postAlert:true},
    {delay:0,success:false,count:12,payload:{result:{state:1,message:'成功'}},expectedOutcome:'success-without-count',postAlert:true},
  ]) {
    const page=await browser.newPage();
    const site=new PrayerSite('',{count(){}},()=>{});
    site.page=page;
    if(!success&&!expectedOutcome) site.uploadResultTimeoutMs=1500;
    let requests=0,returned=false,verified=false;
    page.on('dialog',async dialog=>{site.dialogs.push(dialog.message());await dialog.accept()});
    await page.route('http://fixture.test/**',async route=>{
      if(route.request().method()==='POST') {
        requests++;
        assert.match(route.request().postData() || '',/202609/);
        assert.match(route.request().postData() || '',/487\.jpg/);
        await new Promise(resolve=>setTimeout(resolve,700));
        returned=true;
        return route.fulfill({contentType:'application/json; charset=utf-8',body:JSON.stringify(payload||{result:{message:success?'1':'上传失败'}})});
      }
      return route.fulfill({contentType:'text/html; charset=utf-8',body:`
        <input id="file" type="file" multiple onchange="showMonth()">
        <form id="form"><button type="button" onclick="document.querySelector('#file').click()"><i class="fa-camera"></i></button></form>
        <script>
        function showMonth(){const d=document.createElement('div');d.className='layui-layer';d.innerHTML='<div class="layui-layer-content"><input id="years" name="years"></div><div class="layui-layer-btn"><a class="layui-layer-btn0">确定</a></div>';document.body.append(d);d.querySelector('a').onclick=()=>{const month=document.querySelector('#years').value;setTimeout(()=>d.remove(),50);if(!${Boolean(noConfirm)})setTimeout(()=>showConfirm(month),${delay})}}
        function showConfirm(month){const d=document.createElement('div');d.className='layui-layer';d.innerHTML='<div class="layui-layer-content">确认要上传吗？</div><div class="layui-layer-btn"><a class="layui-layer-btn0">是</a><a class="layui-layer-btn1">否</a></div>';document.body.append(d);d.querySelector('a').onclick=async()=>{d.remove();const files=document.querySelector('#file').files;alert(files.length);alert(files.length);const body=new FormData();body.append('years',month);for(const file of files)body.append('file',file);const result=await fetch('/blessing/mind/uploadPic/name',{method:'POST',body}).then(r=>r.json());if(${postAlert})alert(files.length);const m=document.createElement('div');m.className='layui-layer layui-layer-msg';m.innerHTML='<div class="layui-layer-content">'+result.result.message+'</div>';document.body.append(m)}}
        </script>`});
    });
    site.openImageProcessing=async()=>{await page.goto('http://fixture.test/blessing/mind/toUpload/name')};
    let timer;
    try {
      const startedAt=Date.now();
      const run=Promise.race([
        site.uploadBlessingBatchFromStaged(batchFiles.slice(0,count),'2026-09-30',stage=>{
          if(stage==='verified'){assert.equal(returned,true,'file-count alerts before POST are not success receipts');verified=true}
        }),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('late upload confirmation was never completed')),12000)}),
      ]);
      if(!success) {
        await assert.rejects(run,error=>{
          assert.equal(error.code,'BLESSING_UPLOAD_OUTCOME_UNCONFIRMED');
          if(expectedOutcome) {
            assert.equal(error.uploadEvidence.responseOutcomes[0].category,expectedOutcome);
            assert.equal(error.uploadEvidence.applicationSuccess,expectedOutcome==='success-without-count');
            assert.ok(Date.now()-startedAt<6000,'an explicit response must proceed to reconciliation without the 60 second numeric receipt wait');
          }
          return true;
        });
        assert.equal(requests,noConfirm?0:1);
        assert.equal(verified,false,'failed response cannot be replaced by preflight numeric alerts');
        if(noConfirm) assert.equal(await page.locator('#file').evaluate(input=>input.files.length),0,'failed unsubmitted selection must be cleared');
        continue;
      }
      const result=await run;
      assert.equal(result.uploadedCount,1);
      assert.equal(requests,1,'one confirmation must produce exactly one POST');
      assert.equal(verified,true);
    } finally {clearTimeout(timer);await page.close()}
  }
  console.log('Manual upload browser regression PASS: late confirmation, preparatory alerts, success without count, business failure and exactly one POST');
} finally {await browser.close();fs.rmSync(temp,{recursive:true,force:true})}
