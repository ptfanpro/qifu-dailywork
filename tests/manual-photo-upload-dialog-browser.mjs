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
  for(const {delay,success,noConfirm} of [{delay:0,success:true},{delay:5500,success:true},{delay:0,success:false},{delay:0,success:false,noConfirm:true}]) {
    const page=await browser.newPage();
    const site=new PrayerSite('',{count(){}},()=>{});
    site.page=page;
    if(!success) site.uploadResultTimeoutMs=1500;
    let requests=0,returned=false,verified=false;
    page.on('dialog',async dialog=>{site.dialogs.push(dialog.message());await dialog.accept()});
    await page.route('http://fixture.test/**',async route=>{
      if(route.request().method()==='POST') {
        requests++;
        assert.match(route.request().postData() || '',/202609/);
        assert.match(route.request().postData() || '',/487\.jpg/);
        await new Promise(resolve=>setTimeout(resolve,700));
        returned=true;
        return route.fulfill({contentType:'application/json',body:JSON.stringify({result:{message:success?'1':'上传失败'}})});
      }
      return route.fulfill({contentType:'text/html; charset=utf-8',body:`
        <input id="file" type="file" onchange="showMonth()">
        <form id="form"><button type="button" onclick="document.querySelector('#file').click()"><i class="fa-camera"></i></button></form>
        <script>
        function showMonth(){const d=document.createElement('div');d.className='layui-layer';d.innerHTML='<div class="layui-layer-content"><input id="years" name="years"></div><div class="layui-layer-btn"><a class="layui-layer-btn0">确定</a></div>';document.body.append(d);d.querySelector('a').onclick=()=>{const month=document.querySelector('#years').value;setTimeout(()=>d.remove(),50);if(!${Boolean(noConfirm)})setTimeout(()=>showConfirm(month),${delay})}}
        function showConfirm(month){const d=document.createElement('div');d.className='layui-layer';d.innerHTML='<div class="layui-layer-content">确认要上传吗？</div><div class="layui-layer-btn"><a class="layui-layer-btn0">是</a><a class="layui-layer-btn1">否</a></div>';document.body.append(d);d.querySelector('a').onclick=async()=>{d.remove();alert(1);alert(1);const body=new FormData();body.append('years',month);body.append('file',document.querySelector('#file').files[0]);const result=await fetch('/blessing/mind/uploadPic/name',{method:'POST',body}).then(r=>r.json());const m=document.createElement('div');m.className='layui-layer layui-layer-msg';m.innerHTML='<div class="layui-layer-content">'+result.result.message+'</div>';document.body.append(m)}}
        </script>`});
    });
    site.openImageProcessing=async()=>{await page.goto('http://fixture.test/blessing/mind/toUpload/name')};
    let timer;
    try {
      const run=Promise.race([
        site.uploadBlessingBatchFromStaged([file],'2026-09-30',stage=>{
          if(stage==='verified'){assert.equal(returned,true,'file-count alerts before POST are not success receipts');verified=true}
        }),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('late upload confirmation was never completed')),12000)}),
      ]);
      if(!success) {
        await assert.rejects(run,error=>error.code==='BLESSING_UPLOAD_OUTCOME_UNCONFIRMED');
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
  console.log('Manual upload browser regression PASS: late yes/no confirmation, preparatory alerts and exactly one POST');
} finally {await browser.close();fs.rmSync(temp,{recursive:true,force:true})}
