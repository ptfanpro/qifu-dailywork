// Content-located code observations. This layer never chooses a PDF or order.
import path from 'node:path';
import {createRequire} from 'node:module';
import {recognizeLocalTextLine} from './local-ocr.mjs';
import {parseCompletePrintedCodes} from './printed-code-parser.mjs';
import {horizontalBodyCrop} from './vertical-body-regions.mjs';
export {componentRegions, createTextDetector} from './body-text-detector.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
// A fixed supplemental view for black print on coloured paper. This is the
// SAME Tesseract engine, not a third vote. No crop/answer-dependent tuning.
export async function detectedCodeContrastImage(bytes) {
  return sharp(bytes).toColourspace('srgb').removeAlpha().resize({height:96})
    .extractChannel(0).normalize().png().toBuffer();
}
export function validDetectedCodeReview(read) {
  const extra=(read?.independent||[]).filter(o=>o.preprocessing!=null);
  const review=read?.review;
  if(review===undefined)return extra.length===0;
  if(!review||review.recipe!=='red-channel-96-v1'||review.maxRegions!==4||review.completed!==true
    ||!Number.isInteger(review.attemptedRegions)||review.attemptedRegions<1||review.attemptedRegions>4
    ||!Array.isArray(review.readings)||review.readings.length!==review.attemptedRegions*2)return false;
  const keys=new Set(),indexes=new Set();
  const sameCrop=(a,b)=>a&&b&&['left','top','width','height'].every(k=>a[k]===b[k]);
  for(const r of review.readings) {
    const key=`${r.index}:${r.padding}`;
    if(keys.has(key)||r.engine!=='tesseract'||![.45,.75].includes(r.padding)||r.errorCode!==null
      ||!Number.isInteger(r.index)||r.index<0||r.index>=read.regions
      ||!Number.isFinite(r.confidence)||r.confidence<0||r.confidence>100
      ||!Number.isInteger(r.codeCount)||r.codeCount<0)return false;
    const primary=(read.readings||[]).filter(o=>o.engine==='tesseract'&&o.index===r.index&&o.padding===r.padding);
    if(primary.length!==1||!sameCrop(primary[0].crop,r.crop))return false;
    const observations=extra.filter(o=>o.index===r.index&&o.padding===r.padding);
    if(observations.length!==r.codeCount||observations.some(o=>o.preprocessing!==review.recipe
      ||o.engine!=='tesseract'||o.confidence!==r.confidence||!sameCrop(o.crop,r.crop)))return false;
    keys.add(key);indexes.add(r.index);
  }
  return indexes.size===review.attemptedRegions
    &&extra.every(o=>keys.has(`${o.index}:${o.padding}`));
}
export async function readDetectedCodes(detector,appRoot,source,prefix,{worker=null,recognizeLine=recognizeLocalTextLine,maxRegions=300}={}) {
  if(!Number.isInteger(maxRegions)||maxRegions<1||maxRegions>300)throw Error('Invalid detected-region budget');
  const started=Date.now(),{regions,original}=await detector.detect(source);
  const observations=[],independent=[],readings=[];
  const eligible=regions.map((region,index)=>({region,index,
    crops:[.45,.75].map(padding=>({padding,crop:horizontalBodyCrop(region,original.info,padding)}))}))
    .filter(item=>item.crops.every(view=>view.crop));
  let incompleteTailObserved=false,errors=0,review=null;
  const record=(result,engine,region,index,padding,crop,errorCode=null,supplemental=false)=>{
    const parsed=parseCompletePrintedCodes(result?.text||'',String(prefix));
    const confidence=Number.isFinite(result?.confidence)?result.confidence:0;
    incompleteTailObserved ||= parsed.incompleteTailObserved;
    if(errorCode)errors++;
    (supplemental?review.readings:readings).push({engine,index,padding,crop:{...crop},confidence,codeCount:parsed.codes.length,
      incompleteTailObserved:parsed.incompleteTailObserved,errorCode});
    for(const code of parsed.codes)(engine==='paddle'?observations:independent).push({
      ...code,engine,confidence,padding,region:{...region},index,crop:{...crop},physicalCodeExtent:'unverified',
      ...(supplemental?{preprocessing:'red-channel-96-v1'}:{})});
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
  const code=observations[0]||independent[0];
  const unique=()=>coverage.completed&&!incompleteTailObserved
    &&new Set([...observations,...independent].map(o=>o.fullCode)).size===1&&code.prefix===String(prefix);
  const supported=(rows,threshold)=>new Set(rows.filter(o=>o.confidence>=threshold).map(o=>o.padding)).size===2;
  // Empty/low-confidence corroboration used to return immediately, so no
  // independent same-code reading could ever recover it. Only this absence
  // case receives one fixed review. Opposite strings (even low score), failed
  // coverage, incomplete tails and already confirmed reads never enter it.
  const reviewIndexes=[...new Set(observations.map(o=>o.index))];
  if(worker&&unique()&&supported(observations,.65)&&!supported(independent,30)
    &&reviewIndexes.length>0&&reviewIndexes.length<=4) {
    review={recipe:'red-channel-96-v1',maxRegions:4,attemptedRegions:0,completed:false,readings:[]};
    for(const {region,index,crops} of eligible.filter(item=>reviewIndexes.includes(item.index))) {
      review.attemptedRegions++;
      // Always read both original paddings; no early success or new boxes.
      for(const {padding,crop} of crops) {
        try {
          const bytes=await sharp(original.data,{raw:original.info}).extract(crop).png().toBuffer();
          const result=await worker.recognize(await detectedCodeContrastImage(bytes));
          record(result.data,'tesseract',region,index,padding,crop,null,true);
        } catch {record(null,'tesseract',region,index,padding,crop,'contrast-reader-unavailable',true);}
      }
    }
    review.completed=review.attemptedRegions===reviewIndexes.length&&errors===0;
    coverage.completed&&=review.completed;
  }
  const corroborated=unique()&&supported(observations,.65)&&(!worker||supported(independent,30));
  // Legacy `confirmed` is a diagnostic candidate only, never a product plan.
  return {regions:regions.length,observations,independent,readings,coverage,errors,incompleteTailObserved,
    ...(review?{review}:{}),
    sourceDimensions:{width:original.info.width,height:original.info.height},engines:worker?2:1,
    confirmed:corroborated?code.number:null,bindingVerified:false,seconds:(Date.now()-started)/1000};
}
