// Experimental code decoding; the shared detector does not assign numbers.
import path from 'node:path';
import {createRequire} from 'node:module';
import {recognizeLocalTextLine} from '../../src/local-ocr.mjs';
import {parseCompletePrintedCodes} from '../../src/photo-prepare.mjs';
import {horizontalBodyCrop} from '../../src/vertical-body-regions.mjs';
export {componentRegions, createTextDetector} from '../../src/body-text-detector.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
export async function readDetectedCodes(detector,appRoot,source,prefix,{worker=null,recognizeLine=recognizeLocalTextLine,maxRegions=300}={}) {
  if(!Number.isInteger(maxRegions)||maxRegions<1||maxRegions>300)throw Error('Invalid detected-region budget');
  const started=Date.now(),{regions,original}=await detector.detect(source);
  const observations=[],independent=[],readings=[];
  const eligible=regions.map((region,index)=>({region,index,
    crops:[.45,.75].map(padding=>({padding,crop:horizontalBodyCrop(region,original.info,padding)}))}))
    .filter(item=>item.crops.every(view=>view.crop));
  let incompleteTailObserved=false,errors=0;
  const record=(result,engine,region,index,padding,crop,errorCode=null)=>{
    const parsed=parseCompletePrintedCodes(result?.text||'',String(prefix));
    const confidence=Number.isFinite(result?.confidence)?result.confidence:0;
    incompleteTailObserved ||= parsed.incompleteTailObserved;
    if(errorCode)errors++;
    readings.push({engine,index,padding,crop,confidence,codeCount:parsed.codes.length,
      incompleteTailObserved:parsed.incompleteTailObserved,errorCode});
    for(const code of parsed.codes)(engine==='paddle'?observations:independent).push({
      ...code,engine,confidence,padding,region,index,crop,physicalCodeExtent:'unverified'});
  };
  // No filename, historical number, PDF expected set, or capture order is used.
  // Read both paddings and engines even if the first is blank. A second engine
  // gated by the first model's answer cannot independently audit missed codes.
  // Keep low-scored / foreign / long-tail complete strings BEFORE consensus.
  for(const {region,index,crops} of eligible.slice(0,maxRegions)) {
    for(const {padding,crop} of crops) {
      let bytes;
      try {bytes=await sharp(original.data,{raw:original.info}).extract(crop).png().toBuffer();}
      catch {
        record(null,'paddle',region,index,padding,crop,'crop-unavailable');
        if(worker)record(null,'tesseract',region,index,padding,crop,'crop-unavailable');
        continue;
      }
      try {record(await recognizeLine(appRoot,bytes),'paddle',region,index,padding,crop);}
      catch {record(null,'paddle',region,index,padding,crop,'reader-unavailable');}
      if(worker)try {
        const reading=await worker.recognize(await sharp(bytes).resize({height:96}).greyscale().normalize().png().toBuffer());
        record(reading.data,'tesseract',region,index,padding,crop);
      }catch {record(null,'tesseract',region,index,padding,crop,'reader-unavailable');}
    }
  }
  const coverage={kind:'detected-horizontal-regions',eligibleRegions:eligible.length,
    processedRegions:Math.min(eligible.length,maxRegions),
    completed:eligible.length<=maxRegions&&regions.length<1000&&errors===0};
  const all=[...observations,...independent],codes=new Set(all.map(o=>o.fullCode));
  const code=all[0];
  const unique=coverage.completed&&!incompleteTailObserved&&codes.size===1&&code.prefix===String(prefix);
  const corroborated=unique&&new Set(observations.filter(o=>o.confidence>=.65).map(o=>o.padding)).size===2
    &&(!worker||new Set(independent.filter(o=>o.confidence>=30).map(o=>o.padding)).size===2);
  // Legacy `confirmed` is a diagnostic candidate only, never a product plan.
  return {regions:regions.length,observations,independent,readings,coverage,errors,incompleteTailObserved,
    sourceDimensions:{width:original.info.width,height:original.info.height},engines:worker?2:1,
    confirmed:corroborated?code.number:null,bindingVerified:false,seconds:(Date.now()-started)/1000};
}
