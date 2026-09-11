// Real local OCR engines on generated pixels; no customer data or network.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
import {createOcrWorker,summarizeDetectedCodeRead} from '../src/photo-prepare.mjs';
import {readDetectedCodes,createTextDetector} from '../src/detected-code-reader.mjs';
import {readDetectedObservation,detectedRuntimeFingerprint} from '../src/detected-observation-cache.mjs';
import {recognitionSourceFingerprint} from '../src/recognition-provenance.mjs';
const require=createRequire(import.meta.url),{createCanvas}=require('@napi-rs/canvas');
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-generated-observation-cache-'));
let worker,detector;
try{
  worker=await createOcrWorker(appRoot);
  detector=await createTextDetector(appRoot,path.join(appRoot,'models/paddleocr-zh-v4/ch_PP-OCRv4_det_mobile.onnx'));
  const runtimeFingerprint=detectedRuntimeFingerprint(appRoot);
  assert.match(runtimeFingerprint||'',/^[a-f0-9]{64}$/,'real runtime must enable cache, not silently skip');
  const canvas=createCanvas(640,240),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,640,240);
  ctx.fillStyle='black';ctx.font='40px Arial';ctx.fillText('269-1-168',100,130);const source=canvas.toBuffer('image/png');
  let calls=0;const options={cacheDir,source,fingerprint:recognitionSourceFingerprint(appRoot),runtimeFingerprint,
    prefix:'269',maxRegions:100,read:async bytes=>{calls++;return readDetectedCodes(detector,appRoot,bytes,'269',{worker,maxRegions:100});}};
  const fresh=await readDetectedObservation(options);assert.equal(fresh.cacheHit,false);
  assert.equal(fresh.observation.errors,0);assert.equal(fresh.observation.coverage.completed,true);
  assert(fresh.observation.readings.length>0,'generated code must exercise actual line OCR');
  for(let pass=0;pass<3;pass++){
    const cached=await readDetectedObservation(options);assert.equal(cached.cacheHit,true);
    assert.deepEqual(cached.observation,fresh.observation);assert.equal(cached.observation.bindingVerified,false);
    assert.deepEqual(summarizeDetectedCodeRead(cached.observation,'269',new Set([168])),
      summarizeDetectedCodeRead(fresh.observation,'269',new Set([168])));
  }
  assert.equal(calls,1);
  assert.equal(summarizeDetectedCodeRead(fresh.observation,'269',new Set([169])).number,null);
  console.log('Actual detected observation cache: fixed runtime, 1 fresh + 3 identical cached reads PASS; not business acceptance');
}finally{
  if(worker)await worker.terminate();if(detector)await detector.release();
  const actual=fs.realpathSync(cacheDir);assert.equal(path.dirname(actual).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());
  assert(path.basename(actual).startsWith('qifu-generated-observation-cache-'));fs.rmSync(actual,{recursive:true,force:true});
}
