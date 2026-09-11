// Diagnostic spatial features, not a production classifier or order binding.
import path from 'node:path';
import {createRequire} from 'node:module';
import {verifySiglip2Model,siglip2Input,siglip2Embeddings} from './siglip2-vision.mjs';
const require=createRequire(import.meta.url);

export function patchBytes(tensor){
  if(tensor?.dims?.join(',')!=='2,196,768'||tensor.data?.length!==2*196*768)
    throw Error('Expected two 14x14x768 patch grids');
  const out=Buffer.alloc(2*196*768*4);
  for(let i=0;i<tensor.data.length;i++){
    const v=tensor.data[i];if(!Number.isFinite(v))throw Error('Nonfinite patch feature');
    out.writeFloatLE(v,4*i);
  }
  return out;
}

export async function createSiglip2PatchReader(appRoot,modelFile){
  verifySiglip2Model(modelFile);
  const ort=require(path.join(appRoot,'vendor/onnxruntime-node'));
  const session=await ort.InferenceSession.create(modelFile,{executionProviders:['cpu'],
    intraOpNumThreads:2,interOpNumThreads:1,logSeverityLevel:3});
  if(session.inputNames.join(',')!=='pixel_values'||
     !['pooler_output','last_hidden_state'].every(n=>session.outputNames.includes(n))){
    await session.release();throw Error('Unexpected spatial model contract');
  }
  return {async read(bytes){
    const result=await session.run({pixel_values:new ort.Tensor('float32',siglip2Input(bytes),[2,3,224,224])});
    return {patches:patchBytes(result.last_hidden_state),views:siglip2Embeddings(result.pooler_output)};
  },release:()=>session.release()};
}
