// Diagnostic only: capture the same DB tensor preprocessing used by the product.
// No OCR text, PDF answers, business date, assignment or source mutation here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {componentRegions} from '../../src/body-text-detector.mjs';
const require=createRequire(import.meta.url), sharp=require('sharp');
const modelSha='d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9';

export async function createDbMapReader(appRoot,modelFile) {
  if(crypto.createHash('sha256').update(fs.readFileSync(modelFile)).digest('hex')!==modelSha)
    throw Error('Untrusted detector model');
  const ort=require(path.join(appRoot,'vendor/onnxruntime-node'));
  const session=await ort.InferenceSession.create(modelFile,{executionProviders:['cpu'],graphOptimizationLevel:'all',logSeverityLevel:3,intraOpNumThreads:2,interOpNumThreads:1});
  return {
    async read(source,{maxSide=1536}={}) {
      if(!Number.isSafeInteger(maxSide)||maxSide<32||maxSide>4096)throw Error('Invalid detector budget');
      const original=await sharp(source).rotate().toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true});
      const scale=Math.min(1,maxSide/Math.max(original.info.width,original.info.height));
      const width=Math.max(32,Math.round(original.info.width*scale/32)*32),height=Math.max(32,Math.round(original.info.height*scale/32)*32);
      const rgb=await sharp(original.data,{raw:original.info}).resize(width,height,{fit:'fill'}).raw().toBuffer();
      const plane=width*height,input=new Float32Array(plane*3),mean=[.485,.456,.406],std=[.229,.224,.225];
      if(original.info.channels!==3||rgb.length!==plane*3)throw Error('Invalid RGB tensor');
      for(let c=0;c<3;c++)for(let i=0;i<plane;i++)input[c*plane+i]=(rgb[i*3+2-c]/255-mean[c])/std[c];
      const result=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',input,[1,3,height,width])});
      const out=result[session.outputNames[0]],h=out.dims.at(-2),w=out.dims.at(-1);
      if(out.dims.length!==4||out.dims[0]!==1||out.dims[1]!==1||out.data.length!==w*h
        ||!out.data.every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error('Invalid DB probability map');
      return {probabilities:Float32Array.from(out.data),width:w,height:h,original,
        regions:componentRegions(out.data,w,h).map(b=>({left:b.left/w,top:b.top/h,width:b.width/w,height:b.height/h,score:b.score})),
        modelSha,status:'diagnostic-only-not-binding'};
    },
    async release(){await session.release();},
  };
}
