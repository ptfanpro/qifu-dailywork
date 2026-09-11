// Follow-up offline experiment: fixed complete central window plus EVERY
// existing corner. No saliency selection, predicted role, OCR or page input.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {CLIP_REVISION,CLIP_VIEWS,clipImageValues,unitVector,verifyClipAssets} from './clip-role-reader.mjs';
import {contextRects,CONTEXT_IDS,joinContextViews} from './fixed-context-reader.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export const CENTER_RECIPE='clip-fixed-60percent-center-plus-all-four-corners-v1';

export function centerRect(width,height){
  const bounds=contextRects(width,height)[0];
  return {left:Math.floor((width-bounds.width)/2),top:Math.floor((height-bounds.height)/2),width:bounds.width,height:bounds.height};
}

export async function centerPixels(bytes){
  if(!(bytes instanceof Uint8Array)||!bytes.length)throw Error('Source bytes required');
  const sourceSha256=hash(bytes);
  const {data,info}=await sharp(bytes).rotate().flatten({background:'white'}).toColourspace('srgb')
    .removeAlpha().raw().toBuffer({resolveWithObject:true});
  if(info.channels!==3)throw Error('Three-channel oriented source required');
  const rect=centerRect(info.width,info.height);
  const png=await sharp(data,{raw:info}).extract(rect).png().toBuffer();
  const pixels=await clipImageValues(png,'full-frame');
  if(hash(bytes)!==sourceSha256)throw Error('Source bytes changed during center read');
  return {recipe:CENTER_RECIPE,sourceSha256,sourceDimensions:{width:info.width,height:info.height},rect,
    inputSha256:hash(Buffer.from(pixels.buffer,pixels.byteOffset,pixels.byteLength)),pixels};
}

export function joinCenterContextViews(base,patches,center){
  joinContextViews(base,patches); // Keep the original strict schema checks.
  if(center?.embedding?.length!==512)throw Error('Exactly one complete center feature required');
  const middle=[...unitVector(center.embedding)];
  const locals=CONTEXT_IDS.flatMap(id=>[...unitVector(patches.find(r=>r.id===id).embedding)]);
  return CLIP_VIEWS.map(view=>({view,embedding:[...unitVector([
    ...unitVector(base.find(r=>r.view===view).embedding),...locals,...middle,
  ])]}));
}

export async function createCenterContextEncoder(appRoot,modelDir){
  const assets=verifyClipAssets(modelDir),ort=require(path.join(path.resolve(appRoot),'vendor/onnxruntime-node'));
  const identity={recipe:CENTER_RECIPE,revision:CLIP_REVISION,assets,
    runtimeSha256:hash(fs.readFileSync(path.join(appRoot,'vendor/onnxruntime-node/package.json'))),
    fraction:.6,dimensions:512,preprocessing:'clipImageValues-full-frame-RGB-224-cubic'};
  identity.fingerprint=hash(JSON.stringify(identity));
  const session=await ort.InferenceSession.create(path.join(modelDir,'vision_model_quantized.onnx'),{
    executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1,logSeverityLevel:3});
  return {identity,async read(bytes){
    const input=await centerPixels(bytes);
    const result=await session.run({pixel_values:new ort.Tensor('float32',input.pixels,[1,3,224,224])});
    if(result.image_embeds?.dims.join(',')!=='1,512')throw Error('Invalid actual center model output');
    if(hash(bytes)!==input.sourceSha256)throw Error('Source bytes changed during model inference');
    const {pixels,...metadata}=input;
    return {...metadata,embedding:[...unitVector(result.image_embeds.data)],mayAssignNumber:false,mayUploadScene:false,mayClearCodeConflict:false};
  },release:()=>session.release()};
}
