import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createPinnedEnglishWorker,loadPinnedEnglishModel,ENGLISH_MODEL} from '../src/english-ocr-model.mjs';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');

const modelBytes=loadPinnedEnglishModel(app);
const readModel=async(method,args)=>{assert.equal(method,'readFile');assert.deepEqual(args,['eng.traineddata']);return {data:modelBytes};};
test('English OCR verifies worker model bytes and cannot use machine-dependent cache',async()=>{
  let calls=0,parameters;
  const worker={FS:readModel,setParameters:async p=>{parameters=p;},terminate:async()=>{}};
  const result=await createPinnedEnglishWorker(app,{tessedit_pageseg_mode:'7'}, {createWorker:async(languages,oem,options)=>{
    calls++;assert.equal(oem,1);assert.equal(languages,'eng');
    assert.equal(options.cacheMethod,'none','old eng.traineddata must never override supplied bytes');
    assert.equal(options.langPath,path.resolve(app,'ocr-data'));assert.equal(options.gzip,true);assert.equal(options.cachePath,undefined);
    return worker;
  }});
  assert.equal(result,worker);assert.equal(calls,1);assert.equal(parameters.tessedit_pageseg_mode,'7');
  assert.equal(result.modelIdentity.sha256,ENGLISH_MODEL.sha256);assert(Object.isFrozen(result.modelIdentity));
});

test('same-sized wrong compressed model is rejected before a worker is created',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-english-binding-'));
  try{
    fs.mkdirSync(path.join(root,'ocr-data'));
    const model=fs.readFileSync(path.join(app,ENGLISH_MODEL.relativePath));model[model.length-1]^=1;
    fs.writeFileSync(path.join(root,ENGLISH_MODEL.relativePath),model);
    let calls=0;
    await assert.rejects(createPinnedEnglishWorker(root,{}, {createWorker:async()=>{calls++;}}),/OCR model integrity/);
    assert.equal(calls,0);assert.throws(()=>loadPinnedEnglishModel(root),/OCR model integrity/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('missing English model cannot fall back to cache or a network download',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-english-missing-'));
  try{let calls=0;
    await assert.rejects(createPinnedEnglishWorker(root,{}, {createWorker:async()=>{calls++;}}),/OCR model integrity/);
    assert.equal(calls,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('parameter initialization failure closes the allocated OCR worker',async()=>{
  let terminated=0;
  await assert.rejects(createPinnedEnglishWorker(app,{}, {createWorker:async()=>({
    FS:readModel,setParameters:async()=>{throw Error('synthetic parameters failure');},terminate:async()=>{terminated++;},
  })}),/synthetic parameters failure/);
  assert.equal(terminated,1);
});

test('different bytes loaded inside worker stop recognition and close it',async()=>{
  let configured=0,terminated=0;
  await assert.rejects(createPinnedEnglishWorker(app,{}, {createWorker:async()=>({
    FS:async()=>({data:Buffer.alloc(ENGLISH_MODEL.bytes)}),setParameters:async()=>{configured++;},
    terminate:async()=>{terminated++;},
  })}),/OCR model integrity/);
  assert.equal(configured,0);assert.equal(terminated,1);
});
