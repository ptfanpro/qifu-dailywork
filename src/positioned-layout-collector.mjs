// Collect a current, complete geometry/position observation. This is NOT a
// page-number resolver. Neither the report nor a serialized copy authorizes
// assignment, clearing a code conflict, scene upload or an online order action.
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {validPositionedBodyViews} from './body-positioned-observation.mjs';
import {matchPrintedLayouts,isFreshLayoutObservation} from './layout-runtime.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const digest=value=>hash(JSON.stringify(value));
const retained=new WeakMap();
const pageId=/^[a-f0-9]{64}:[1-9][0-9]{0,4}$/,photoId=/^[a-f0-9]{64}$/;

export function layoutBatches(pages,photos){
 if(!Array.isArray(pages)||!pages.length||pages.length>512||!Array.isArray(photos)||!photos.length||photos.length>32
  ||pages.length*photos.length>4096)throw Error('Positioned layout budget exceeded');
 if(pages.some(p=>!pageId.test(p?.id||''))||photos.some(p=>!photoId.test(p?.id||''))
  ||new Set(pages.map(p=>p.id)).size!==pages.length||new Set(photos.map(p=>p.id)).size!==photos.length)
  throw Error('Invalid or duplicate positioned identity');
 const batches=[];
 for(let i=0;i<photos.length;i+=8)for(let j=0;j<pages.length;j+=32)
  batches.push({photos:photos.slice(i,i+8),pages:pages.slice(j,j+32)});
 return batches;
}

export async function preparePositionedLayoutInput({id,source,views,fieldTexts=[]}){
 if(!Buffer.isBuffer(source)||source.length>50_000_000||(!pageId.test(id||'')&&!photoId.test(id||'')))
  throw Error('Invalid positioned image identity');
 const bytes=Buffer.from(source),sourceSha256=hash(bytes),savedViews=structuredClone(views);
 if(!Array.isArray(fieldTexts)||fieldTexts.length>10000||fieldTexts.some(t=>typeof t!=='string')||JSON.stringify(fieldTexts).length>1_000_000)
  throw Error('Invalid positioned PDF field corpus');
 const savedFields=[...fieldTexts];
 if(photoId.test(id)&&id!==sourceSha256)throw Error('Positioned photo identity changed');
 if(!validPositionedBodyViews(savedViews))throw Error('Incomplete positioned body observations');
 // Exactly the body's oriented sRGB coordinate system before reducing to the
 // worker's bounded size. Normalized region positions remain observations in
 // the original body dimensions; consumers must use the supplied geometry size.
 const decoded=await sharp(bytes,{limitInputPixels:30_000_000}).rotate().toColourspace('srgb')
  .removeAlpha().raw().toBuffer({resolveWithObject:true});
 const size=savedViews[0].positioned.dimensions;
 if(decoded.info.width!==size.width||decoded.info.height!==size.height)throw Error('Body/image dimensions disagree');
 const rendered=await sharp(decoded.data,{raw:decoded.info}).greyscale()
  .resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
 if(Math.min(rendered.info.width,rendered.info.height)<32)throw Error('Positioned image is too small');
 return {id,sourceSha256,viewsSha256:digest(savedViews),views:savedViews,fieldTexts:savedFields,fieldTextsSha256:digest(savedFields),bytes:rendered.data,
  imageSha256:hash(rendered.data),shape:[rendered.info.height,rendered.info.width]};
}

export async function collectPositionedLayouts({appRoot,pages,photos,onProgress=null,maxTotalMs=300_000}){
 layoutBatches(pages,photos);
 if(!Number.isInteger(maxTotalMs)||maxTotalMs<1||maxTotalMs>300_000)throw Error('Invalid positioned runtime budget');
 // Snapshot every byte and field before the first await. No partial observation
 // is returned after an incomplete batch, mutated request, timeout or failure.
 let bytes=0;
 const snapshot=items=>items.map(p=>{
  if(!Buffer.isBuffer(p.source))throw Error('Missing positioned image bytes');
  bytes+=p.source.length;if(bytes>300_000_000)throw Error('Positioned image budget exceeded');
  return {id:p.id,source:Buffer.from(p.source),views:structuredClone(p.views),fieldTexts:structuredClone(p.fieldTexts??[])};
 });
 const originals={pages:snapshot(pages),photos:snapshot(photos)},started=Date.now();
 const prepared={pages:[],photos:[]};
 for(const kind of ['pages','photos'])for(const p of originals[kind])prepared[kind].push(await preparePositionedLayoutInput(p));
 const all=[],batches=layoutBatches(prepared.pages,prepared.photos);
 const byPhoto=new Map(prepared.photos.map(p=>[p.id,{id:p.id,sourceSha256:p.sourceSha256,viewsSha256:p.viewsSha256,
  imageSha256:p.imageSha256,shape:p.shape,pages:[]}]));
 for(const [i,batch] of batches.entries()){
  const remaining=maxTotalMs-(Date.now()-started);
  if(remaining<=0)throw Error('Positioned layout timed out');
  const result=await matchPrintedLayouts(appRoot,{...batch,timeoutMs:Math.min(180_000,remaining)});
  if(!isFreshLayoutObservation(result))throw Error('Positioned layout observation is not fresh');
  for(const photo of result.results){
   const expectedPhoto=prepared.photos.find(p=>p.id===photo.id);
   if(photo.imageSha256!==expectedPhoto.imageSha256||digest(photo.shape)!==digest(expectedPhoto.shape))
    throw Error('Positioned photo geometry identity mismatch');
   for(const page of photo.pages){
    const expectedPage=prepared.pages.find(p=>p.id===page.id);
    if(page.imageSha256!==expectedPage?.imageSha256||digest(page.shape)!==digest(expectedPage.shape))
     throw Error('Positioned page geometry identity mismatch');
   }
   byPhoto.get(photo.id).pages.push(...photo.pages);
  }
  all.push(result);
  onProgress?.(`位置版式观察：已完成 ${i+1}/${batches.length} 批；仅采集证据，不自动消除编号冲突。`);
 }
 const ids=prepared.pages.map(p=>p.id);
 for(const photo of byPhoto.values())if(digest(photo.pages.map(p=>p.id))!==digest(ids))
  throw Error('Incomplete or duplicated positioned PDF corpus');
 if(all.some(result=>!isFreshLayoutObservation(result)))throw Error('Changed positioned worker observation');
 const inputSummary=items=>items.map(({id,sourceSha256,viewsSha256,fieldTextsSha256,imageSha256,shape})=>({id,sourceSha256,viewsSha256,fieldTextsSha256,imageSha256,shape}));
 const report={schemaVersion:1,status:'positioned-layout-observation-not-binding',complete:true,
  pages:inputSummary(prepared.pages),photos:inputSummary(prepared.photos),
  pageCount:prepared.pages.length,photoCount:prepared.photos.length,comparisons:prepared.pages.length*prepared.photos.length,
  geometryCandidates:[...byPhoto.values()].reduce((n,p)=>n+p.pages.filter(q=>q.evidence.candidate).length,0),
  batches:batches.length,requestHashes:all.map(r=>r.requestSha256),seconds:(Date.now()-started)/1000,
  runtimeManifestSha256:all[0].runtimeManifestSha256,geometrySourceSha256:all[0].geometrySourceSha256,
  mayAssignNumber:false,mayClearCodeConflict:false,bindingVerified:false};
 const payload={pages:prepared.pages.map(({bytes,...p})=>p),photos:prepared.photos.map(({bytes,...p})=>p),
  results:[...byPhoto.values()]};
 retained.set(report,{seal:digest(report),payload});
 return report;
}

// Private text and coordinates never go in persisted plan summaries or logs.
// A future adjudicator must still bind the entire body corpus, raw full code,
// physical PDF bytes/index and photo bytes. A live report alone is not enough.
export function positionedLayoutEvidence(report){
 try{const saved=report&&retained.get(report);return saved&&saved.seal===digest(report)?structuredClone(saved.payload):null;}
 catch{return null;}
}
