// Diagnostic-only alternate line reader. No detector, PDF answers or assignments.
// Model and preprocessing sources are pinned in SERVER-CODE-EXPERIMENT.md.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {embeddedChineseDictionary} from '../../src/chinese-body-reader.mjs';
import {decodePaddleCtc} from '../../src/local-ocr.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
export const SERVER_CODE_MODEL_SHA256='e09385400eaaaef34ceff54aeb7c4f0f1fe014c27fa8b9905d4709b65746562a';
export const SERVER_CODE_RECIPE='bgr-chw-48-dynamic320-2048-linear-zero-pad-v1';
export function verifyServerCodeModel(modelFile) {
  const bytes=fs.readFileSync(modelFile);
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==SERVER_CODE_MODEL_SHA256)
    throw Error('Untrusted server recognition model');
  const dictionary=embeddedChineseDictionary(bytes);
  if(!dictionary.some(c=>/\p{Script=Han}/u.test(c)))throw Error('Expected embedded Chinese alphabet');
  return {bytes,dictionary};
}
export async function serverCodeImageValues(source) {
  const decoded=await sharp(source,{limitInputPixels:30_000_000}).toColourspace('srgb').flatten({background:'#fff'})
    .removeAlpha().raw().toBuffer({resolveWithObject:true});
  if(decoded.info.channels!==3)throw Error('Invalid RGB input');
  const height=48,resizedWidth=Math.ceil(height*decoded.info.width/decoded.info.height);
  if(resizedWidth<1||resizedWidth>2048)throw Error('Line aspect ratio outside fixed budget');
  const width=Math.max(320,resizedWidth);
  const rgb=await sharp(decoded.data,{raw:decoded.info}).resize(resizedWidth,height,{fit:'fill',kernel:'linear'}).raw().toBuffer();
  if(rgb.length!==resizedWidth*height*3)throw Error('Invalid resized RGB bytes');
  const plane=width*height,values=new Float32Array(plane*3);
  for(let y=0;y<height;y++)for(let x=0;x<resizedWidth;x++)for(let c=0;c<3;c++)
    values[c*plane+y*width+x]=(rgb[(y*resizedWidth+x)*3+2-c]/255-.5)/.5;
  return {values,dims:[1,3,height,width],resizedWidth};
}
// Additional raw-lexeme measurement, not a replacement for the product parser.
// Separators may be glyph variants; letters are never silently converted to digits.
// Lines remain separate so the end of one line cannot complete another line's code.
export function literalCodeObservations(rawText) {
  const codes=new Set();let splitTailObserved=false;
  for(const line of String(rawText||'').split(/[\r\n\v\f\u0085\u2028\u2029]+/)) {
    const normalized=line.replace(/[—–_·•﹣－−]/g,'-').replace(/[^\S\r\n]*-[^\S\r\n]*/g,'-');
    for(const match of normalized.matchAll(/(?<![\p{L}\p{N}-])(\d{3,4})-1-(\d{1,4})(?![\p{L}\p{N}-])/gu)) {
      const after=normalized.slice(match.index+match[0].length);
      if(/^\s+\d/.test(after)&&!/^\s+\d{3,4}-1-\d/.test(after)){splitTailObserved=true;continue;}
      if(Number(match[2])>0)codes.add(match[0]);
    }
  }
  return {codes:[...codes],splitTailObserved};
}
export async function createServerCodeReader(appRoot,modelFile) {
  const {bytes,dictionary}=verifyServerCodeModel(modelFile);
  const ort=require(path.resolve(appRoot,'vendor/onnxruntime-node'));
  const session=await ort.InferenceSession.create(bytes,{executionProviders:['cpu'],graphOptimizationLevel:'all',
    logSeverityLevel:3,intraOpNumThreads:2,interOpNumThreads:1});
  return {modelSha256:SERVER_CODE_MODEL_SHA256,dictionaryLength:dictionary.length,recipe:SERVER_CODE_RECIPE,
    async readLine(source){
      const {values,dims}=await serverCodeImageValues(source);
      const outputs=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',values,dims)});
      return decodePaddleCtc(outputs[session.outputNames[0]],dictionary);
    },
    async release(){await session.release();},
  };
}
