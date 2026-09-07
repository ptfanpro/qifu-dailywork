// Offline experiment only; not imported by the production executor.
// Model: RapidAI PP-OCRv4 DB mobile, pinned published digest. Preprocessing
// follows PaddleOCR release/2.7 predict_det.py (Apache-2.0). Region extraction
// below is an independent connected-component proposal generator, NOT an
// implementation claiming equivalence with DB polygon/unclip postprocessing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {recognizeLocalTextLine} from '../../src/local-ocr.mjs';
import {parseLocalOcrCodeCandidates} from '../../src/photo-prepare.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
const MODEL_SHA='d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9';
export function componentRegions(probabilities,width,height,{threshold=.3,minScore=.6}={}) {
  if(probabilities.length!==width*height) throw Error('invalid detector map');
  const seen=new Uint8Array(probabilities.length),queue=new Int32Array(probabilities.length),regions=[];
  for(let seed=0;seed<seen.length;seed++) {
    if(seen[seed]||!(probabilities[seed]>=threshold)) continue;
    let head=0,tail=1,left=width,right=0,top=height,bottom=0,sum=0;
    queue[0]=seed;seen[seed]=1;
    while(head<tail) {
      const index=queue[head++],x=index%width,y=Math.floor(index/width);
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);sum+=probabilities[index];
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
        const xx=x+dx,yy=y+dy,next=yy*width+xx;
        if(xx<0||xx>=width||yy<0||yy>=height||seen[next]||!(probabilities[next]>=threshold)) continue;
        seen[next]=1;queue[tail++]=next;
      }
    }
    const w=right-left+1,h=bottom-top+1;
    if(w<6||h<3||sum/tail<minScore||tail<12) continue;
    regions.push({left,top,width:w,height:h,score:sum/tail});
  }
  return regions.sort((a,b)=>a.top-b.top||a.left-b.left).slice(0,1000);
}
export async function createTextDetector(appRoot,modelFile) {
  if(crypto.createHash('sha256').update(fs.readFileSync(modelFile)).digest('hex')!==MODEL_SHA) throw Error('untrusted detector model');
  const ort=require(path.join(appRoot,'vendor/onnxruntime-node'));
  const session=await ort.InferenceSession.create(modelFile,{executionProviders:['cpu'],graphOptimizationLevel:'all',logSeverityLevel:3,intraOpNumThreads:2,interOpNumThreads:1});
  return {
    async detect(source,{maxSide=1536}={}) {
      const original=await sharp(source).rotate().toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true});
      const scale=Math.min(1,maxSide/Math.max(original.info.width,original.info.height));
      const width=Math.max(32,Math.round(original.info.width*scale/32)*32),height=Math.max(32,Math.round(original.info.height*scale/32)*32);
      const rgb=await sharp(original.data,{raw:original.info}).resize(width,height,{fit:'fill'}).raw().toBuffer();
      const plane=width*height,input=new Float32Array(plane*3),mean=[.485,.456,.406],std=[.229,.224,.225];
      for(let c=0;c<3;c++) for(let i=0;i<plane;i++) input[c*plane+i]=(rgb[i*3+2-c]/255-mean[c])/std[c];
      const result=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',input,[1,3,height,width])});
      const output=result[session.outputNames[0]],h=output.dims.at(-2),w=output.dims.at(-1);
      const regions=componentRegions(output.data,w,h).map(box=>({
        left:box.left/w,top:box.top/h,width:box.width/w,height:box.height/h,score:box.score,
      }));
      return {regions,original};
    },
    async release(){await session.release();},
  };
}
export async function readDetectedCodes(detector,appRoot,source,prefix,{worker=null}={}) {
  const started=Date.now(),{regions,original}=await detector.detect(source);
  const observations=[],independent=[];
  // No filename, historical number, PDF expected set, or capture order is used.
  for(const region of regions) {
    if(region.width/region.height<1.5||region.height>.1) continue;
    for(const padding of [.45,.75]) {
      const pad=region.height*padding;
      const x=Math.max(0,Math.floor((region.left-pad)*original.info.width));
      const y=Math.max(0,Math.floor((region.top-pad)*original.info.height));
      const right=Math.min(original.info.width,Math.ceil((region.left+region.width+pad)*original.info.width));
      const bottom=Math.min(original.info.height,Math.ceil((region.top+region.height+pad)*original.info.height));
      const crop=await sharp(original.data,{raw:original.info}).extract({left:x,top:y,width:right-x,height:bottom-y}).png().toBuffer();
      const result=await recognizeLocalTextLine(appRoot,crop);
      if(result.confidence<.65) continue;
      const codes=parseLocalOcrCodeCandidates(result.text,prefix).filter(c=>c.prefixDistance<=.1);
      for(const code of codes) observations.push({number:code.number,confidence:result.confidence,padding,region});
      if(codes.length&&worker) {
        const tesseract=await worker.recognize(await sharp(crop).resize({height:96}).greyscale().normalize().png().toBuffer());
        for(const code of parseLocalOcrCodeCandidates(tesseract.data.text,prefix).filter(c=>c.prefixDistance<=.1)) {
          independent.push({number:code.number,padding,confidence:tesseract.data.confidence,region});
        }
      }
      // Most regions are titles/body; spend a second view only on a full code.
      if(!codes.length) break;
    }
  }
  const groups=new Map();
  for(const item of observations) {if(!groups.has(item.number))groups.set(item.number,new Set());groups.get(item.number).add(item.padding);}
  const confirmed=[...groups].filter(([number,views])=>views.size>=2&&(!worker||
    new Set(independent.filter(item=>item.number===number&&item.confidence>=30).map(item=>item.padding)).size>=2)).map(([number])=>number);
  return {regions:regions.length,observations,independent,engines:worker?2:1,confirmed:confirmed.length===1?confirmed[0]:null,seconds:(Date.now()-started)/1000};
}
