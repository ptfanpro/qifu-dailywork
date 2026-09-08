// Experimental code decoding; the shared detector does not assign numbers.
import path from 'node:path';
import {createRequire} from 'node:module';
import {recognizeLocalTextLine} from '../../src/local-ocr.mjs';
import {parseLocalOcrCodeCandidates} from '../../src/photo-prepare.mjs';
export {componentRegions, createTextDetector} from '../../src/body-text-detector.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
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
