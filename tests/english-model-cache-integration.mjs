// Generated text only. Demonstrate the old cache-first behavior and verify
// actual bytes inside both the new helper and the production worker.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createPinnedEnglishWorker,loadPinnedEnglishModel,ENGLISH_MODEL} from '../src/english-ocr-model.mjs';
import {createOcrWorker} from '../src/photo-prepare.mjs';
const require=createRequire(import.meta.url),{createWorker}=require('tesseract.js'),{createCanvas}=require('@napi-rs/canvas');
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-english-cache-integration-'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const model=loadPinnedEnglishModel(app),cache=Buffer.concat([model,Buffer.from('synthetic-stale-cache-marker')]);
const cacheFile=path.join(root,'eng.traineddata');fs.writeFileSync(cacheFile,cache);
let worker;
try{
  worker=await createWorker('eng',1,{langPath:path.join(app,'ocr-data'),gzip:true,cachePath:root,cacheMethod:'readOnly'});
  const legacy=await worker.FS('readFile',['eng.traineddata']);
  assert.equal(hash(legacy.data),hash(cache),'baseline really loads stale cache instead of bundled bytes');
  await worker.terminate();worker=null;
  worker=await createPinnedEnglishWorker(app,{tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789-'},
    {createWorker:(languages,oem,options)=>createWorker(languages,oem,{...options,cachePath:root})});
  const corrected=await worker.FS('readFile',['eng.traineddata']);
  assert.equal(hash(corrected.data),ENGLISH_MODEL.sha256);
  const canvas=createCanvas(720,180),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,720,180);
  ctx.fillStyle='black';ctx.font='48px Arial';ctx.fillText('269-1-168',80,110);
  const result=await worker.recognize(canvas.toBuffer('image/png'));
  assert.equal(result.data.text.trim(),'269-1-168');
  await worker.terminate();worker=null;
  worker=await createOcrWorker(app);
  assert.equal(hash((await worker.FS('readFile',['eng.traineddata'])).data),ENGLISH_MODEL.sha256);
  assert.equal(hash(fs.readFileSync(cacheFile)),hash(cache),'old cache is preserved, not deleted or overwritten');
  console.log('English model cache integration PASS: old cache override reproduced; pinned helper and production worker load exact bundled bytes; generated code read; old cache unchanged');
}finally{
  if(worker)await worker.terminate();
  const actual=fs.realpathSync(root);assert.equal(path.dirname(actual).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());
  assert(path.basename(actual).startsWith('qifu-english-cache-integration-'));fs.rmSync(actual,{recursive:true,force:true});
}
