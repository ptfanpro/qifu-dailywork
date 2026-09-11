// Offline diagnostic encoder. No downloads, prompts, OCR or production imports.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export const SIGLIP2_REVISION='ba1f3b0843f24bc5417d38e19c37b287d719b2f4';
export const SIGLIP2_SHA256='0dd31785a2713f1113ef2272472165c69d580473dae38d7b47568ac587795e70';
export const SIGLIP2_VIEWS=['center-crop','full-frame'];

export function verifySiglip2Model(file){
  const actual=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if(actual!==SIGLIP2_SHA256)throw Error('SigLIP2 model integrity mismatch');
  return actual;
}

export function siglip2Input(bytes){
  if(bytes.length!==2*3*224*224*4)throw Error('Two explicit RGB CHW views required');
  const values=new Float32Array(bytes.length/4);
  for(let i=0;i<values.length;i++){
    const v=bytes.readFloatLE(i*4);
    if(!Number.isFinite(v)||v < -1 || v > 1)throw Error('Invalid normalized RGB pixels');
    values[i]=v;
  }
  return values;
}

export function siglip2Embeddings(tensor){
  if(tensor?.dims?.join(',')!=='2,768')throw Error('Unexpected SigLIP2 pooled output');
  return SIGLIP2_VIEWS.map((view,i)=>{
    const a=Array.from(tensor.data.slice(i*768,(i+1)*768));
    if(a.length!==768||a.some(v=>!Number.isFinite(v)))throw Error('Invalid SigLIP2 embedding');
    const norm=Math.hypot(...a);if(norm<1e-10)throw Error('Zero SigLIP2 embedding');
    return {view,embedding:a.map(v=>v/norm)};
  });
}

export async function createSiglip2Reader(appRoot,modelFile){
  verifySiglip2Model(modelFile);
  const ort=require(path.join(appRoot,'vendor/onnxruntime-node'));
  const session=await ort.InferenceSession.create(modelFile,{executionProviders:['cpu'],
    intraOpNumThreads:2,interOpNumThreads:1,logSeverityLevel:3});
  if(session.inputNames.join(',')!=='pixel_values'||!session.outputNames.includes('pooler_output')){
    await session.release();throw Error('Unexpected model contract');
  }
  return {async read(bytes){
    const result=await session.run({pixel_values:new ort.Tensor('float32',siglip2Input(bytes),[2,3,224,224])});
    return siglip2Embeddings(result.pooler_output);
  },release:()=>session.release()};
}
