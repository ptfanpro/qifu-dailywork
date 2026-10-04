// Exercise the production upload/recovery coordinator against a local browser
// response matching the incident: two preparatory counts, confirmation, success.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {PrayerSite} from '../src/site.mjs';
import {uploadManualBatchWithRecovery,needsManualUploadRecovery,manualAttemptFilesVerified,assertManualAttemptResolved} from '../src/manual-upload-attempt.mjs';
import {reconcileManualUploadedPhotos} from '../src/manual-upload-reconciliation.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp'),{chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-upload-recovery-browser-'));
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const files=[],fileHashes={},buffers=[];
  for(let n=0;n<12;n++) {
    const bytes=await sharp(Buffer.from(`<svg width="1800" height="1350"><rect width="1800" height="1350" fill="rgb(${30+n*12},${200-n*10},${80+n*8})"/><rect x="${60+n*40}" y="250" width="400" height="650" fill="black"/></svg>`)).jpeg().toBuffer();
    const file=path.join(temp,`${n+1}.jpg`);
    fs.writeFileSync(file,bytes);files.push(file);buffers.push(bytes);
    fileHashes[path.basename(file)]=crypto.createHash('sha256').update(bytes).digest('hex');
  }
  for(const visibleCount of [12,7]) {
    const page=await browser.newPage();
    const site=new PrayerSite('',{count(){}},()=>{});
    site.page=page;site.tempRoot=temp;site.uploadResultTimeoutMs=2500;
    let posts=0,responded=false,onlineCount=visibleCount,continuedToScenes=false;
    const saved={};
    page.on('dialog',async dialog=>{site.dialogs.push(dialog.message());await dialog.accept()});
    await page.route('http://recovery.test/**',async route=>{
      if(route.request().method()==='POST') {
        posts++;
        assert.match(route.request().postData()||'',/202610/);
        responded=true;
        return route.fulfill({contentType:'application/json',body:JSON.stringify({result:{state:1,message:'成功'}})});
      }
      return route.fulfill({contentType:'text/html; charset=utf-8',body:`
        <input id="file" type="file" multiple onchange="showMonth()">
        <form id="form"><button type="button" onclick="document.querySelector('#file').click()"><i class="fa-camera"></i></button></form>
        <script>
        function showMonth(){alert(12);alert(12);const d=document.createElement('div');d.className='layui-layer';d.innerHTML='<input id="years"><a class="layui-layer-btn0">确定</a>';document.body.append(d);d.querySelector('a').onclick=async()=>{const month=d.querySelector('input').value;d.remove();if(!confirm('确认要上传吗？'))return;const body=new FormData();body.append('years',month);for(const file of document.querySelector('#file').files)body.append('file',file);const data=await fetch('/blessing/mind/uploadPic/name',{method:'POST',body}).then(r=>r.json());const m=document.createElement('div');m.className='layui-layer layui-layer-msg';m.innerHTML='<div class="layui-layer-content">'+data.result.message+'</div>';document.body.append(m)}}
        </script>`});
    });
    site.openImageProcessing=async()=>{await page.goto('http://recovery.test/upload')};
    site.queryUploadedPhotoReferences=async(date,kind)=>{
      assert.equal(date,'2026-10-03');assert.equal(responded,true);
      return kind==='lamp'?buffers.slice(0,onlineCount).map((_,i)=>({kind,id:`order-${i}`,url:`image-${i}`})):[];
    };
    site.readUploadedPhotoBytes=async url=>buffers[Number(url.replace('image-',''))];
    site.closePhotoReadback=async()=>{};
    const onMatch=async item=>{saved[item.name]=item;fs.writeFileSync(path.join(temp,'receipt.json'),JSON.stringify(saved))};
    try {
      const run=uploadManualBatchWithRecovery({site,date:'2026-10-03',files,allFiles:files,fileHashes,onMatch});
      if(visibleCount===12) {
        const result=await run;
        assert.equal(result.uploadedCount,12);assert.equal(result.evidence,'online-image-readback');
        continuedToScenes=true;
        assert.equal(Object.keys(saved).length,12);
      } else {
        await assert.rejects(run,error=>error.code==='MANUAL_UPLOAD_READBACK_INCOMPLETE'&&error.readback.missingNames.length===5);
        assert.equal(Object.keys(saved).length,7,'confirmed files persist before the uncertain subset stops');
        // A restart only reads missing files after the backend has finished.
        onlineCount=12;
        const pending=files.filter(file=>!saved[path.basename(file)]);
        const resumed=await reconcileManualUploadedPhotos({site,date:'2026-10-03',files:pending,allFiles:files,fileHashes,onMatch});
        assert.deepEqual(resumed.missingNames,[]);assert.equal(Object.keys(saved).length,12);
      }
      assert.equal(continuedToScenes,visibleCount===12);
      assert.equal(posts,1,'receipt recovery and restart must never repeat the POST');
      assert.equal(site.dialogs.filter(x=>x==='12').length,2);
      const checkpoint={complete:false,fileSetHash:'old-scene',uncertainSubmission:true,
        currentBatchFiles:files.slice(0,7).map(file=>path.basename(file)),uploadedFiles:saved};
      assert.equal(needsManualUploadRecovery(checkpoint),true,'changing scene hash does not skip recovery');
      assert.equal(manualAttemptFilesVerified(checkpoint,fileHashes),true,'completed old batch does not lock a later batch');
      const changed={...fileHashes,'1.jpg':'different'};
      assert.equal(manualAttemptFilesVerified(checkpoint,changed),false);
      assert.equal(manualAttemptFilesVerified({...checkpoint,currentBatchFiles:[]},fileHashes),false);
      const removed={...fileHashes}; delete removed['2.jpg'];
      assert.throws(()=>assertManualAttemptResolved(checkpoint,removed),error=>error.code==='MANUAL_UPLOAD_PREVIOUS_ATTEMPT_UNRESOLVED');
      assert.doesNotThrow(()=>assertManualAttemptResolved(checkpoint,fileHashes));
    } finally {await page.close()}
  }
  console.log('Manual upload browser recovery PASS: 12-file success without count, one POST, partial receipt durability, read-only restart');
} finally {
  await browser.close();
  const actual=fs.realpathSync(temp),parent=fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(actual).toLowerCase(),parent.toLowerCase());
  assert.ok(path.basename(actual).startsWith('qifu-upload-recovery-browser-'));
  fs.rmSync(actual,{recursive:true,force:true});
}
