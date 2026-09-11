// Offline spatial-detail experiment. All fixed regions are retained. No role
// answer, OCR number, filename, nearest-template selection or business action.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {CLIP_REVISION,CLIP_VIEWS,clipImageValues,unitVector,verifyClipAssets} from './clip-role-reader.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export const CONTEXT_RECIPE='clip-fixed-60percent-four-corners-all-positions-v1';
export const CONTEXT_IDS=Object.freeze(['top-left','top-right','bottom-left','bottom-right']);

export function contextRects(width,height){
  if(![width,height].every(n=>Number.isSafeInteger(n)&&n>=64&&n<=20000)||width*height>120000000)
    throw Error('Bounded oriented source dimensions required');
  const w=Math.ceil(width*.6),h=Math.ceil(height*.6);
  return CONTEXT_IDS.map((id,i)=>({id,left:i%2?width-w:0,top:i>=2?height-h:0,width:w,height:h}));
}

export async function contextPixels(bytes){
  if(!(bytes instanceof Uint8Array)||!bytes.length)throw Error('Source image bytes required');
  const before=hash(bytes);
  const {data,info}=await sharp(bytes).rotate().flatten({background:'white'}).toColourspace('srgb')
    .removeAlpha().raw().toBuffer({resolveWithObject:true});
  if(info.channels!==3)throw Error('Three-channel oriented pixels required');
  const regions=[];
  for(const rect of contextRects(info.width,info.height)){
    const {id,...bounds}=rect;
    const png=await sharp(data,{raw:info}).extract(bounds).png().toBuffer();
    // Entire local window survives. Full-frame padding is the established
    // CLIP diagnostic recipe, not another crop selected by a class score.
    const pixels=await clipImageValues(png,'full-frame');
    regions.push({id,rect,pixels,inputSha256:hash(Buffer.from(pixels.buffer,pixels.byteOffset,pixels.byteLength))});
  }
  if(hash(bytes)!==before)throw Error('Source bytes changed during preprocessing');
  return {recipe:CONTEXT_RECIPE,sourceSha256:before,sourceDimensions:{width:info.width,height:info.height},regions};
}

export function joinContextViews(base,patches){
  if(!Array.isArray(base)||base.length!==2||!Array.isArray(patches)||patches.length!==4)
    throw Error('Complete base views and four context positions required');
  const normalized=(rows,key,names)=>names.map(name=>{
    const selected=rows.filter(r=>r?.[key]===name);
    if(selected.length!==1||selected[0].embedding?.length!==512)throw Error('Duplicate/missing/invalid context vector');
    return [...unitVector(selected[0].embedding)];
  });
  const globals=normalized(base,'view',CLIP_VIEWS),locals=normalized(patches,'id',CONTEXT_IDS).flat();
  // Shared local features do not constitute independent votes. Keep all
  // locations, concatenate in declared order and normalize the descriptor.
  return CLIP_VIEWS.map((view,i)=>({view,embedding:[...unitVector([...globals[i],...locals])]}));
}

export async function createFixedContextEncoder(appRoot,modelDir){
  const assets=verifyClipAssets(modelDir),ort=require(path.join(path.resolve(appRoot),'vendor/onnxruntime-node'));
  const runtimeSha256=hash(fs.readFileSync(path.join(appRoot,'vendor/onnxruntime-node/package.json')));
  const identity={recipe:CONTEXT_RECIPE,revision:CLIP_REVISION,assets,runtimeSha256,
    regions:CONTEXT_IDS,regionFraction:.6,dimensions:512,preprocessing:'clipImageValues-full-frame-RGB-224-cubic'};
  identity.fingerprint=hash(JSON.stringify(identity));
  const session=await ort.InferenceSession.create(path.join(modelDir,'vision_model_quantized.onnx'),{
    executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1,logSeverityLevel:3});
  return {identity,async read(bytes){
    const input=await contextPixels(bytes),regions=[];
    for(const r of input.regions){
      const result=await session.run({pixel_values:new ort.Tensor('float32',r.pixels,[1,3,224,224])});
      if(result.image_embeds?.dims.join(',')!=='1,512')throw Error('Invalid actual context model output');
      regions.push({id:r.id,rect:r.rect,inputSha256:r.inputSha256,embedding:[...unitVector(result.image_embeds.data)]});
    }
    return {...input,regions,mayAssignNumber:false,mayUploadScene:false,mayClearCodeConflict:false};
  },release:()=>session.release()};
}
