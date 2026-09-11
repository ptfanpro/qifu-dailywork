// A fresh alternate-model observation of the ORIGINAL code crops. It never
// assigns a number, edits a raw audit, or chooses pixels from a PDF answer.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {createChineseBodyReader,CHINESE_BODY_MODEL_SHA256} from './chinese-body-reader.mjs';
import {parseCompletePrintedCodes} from './printed-code-parser.mjs';
import {createServerCodeReader,SERVER_CODE_MODEL_SHA256} from './server-code-reader.mjs';
import {prefixReviewSeed,prefixReviewSupport} from './prefix-code-policy.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const digest=v=>hash(JSON.stringify(v)),fresh=new WeakMap();

export function codeModelReviewEvidence(report,read,photoSha256){
 const saved=report&&fresh.get(report);
 return saved&&saved.seal===digest(report)&&report.photoSha256===photoSha256
  &&report.baseReadSha256===digest(read)?structuredClone(saved.rows):null;
}

async function observeModel({source,read,reader,modelSha256,recipe}){
 const bytes=Buffer.from(source),base=structuredClone(read),photoSha256=hash(bytes);
 if(photoSha256!==base.inputSha256||reader.modelSha256!==modelSha256)
  throw Error('alternate-code-source-or-model-mismatch');
 const indexes=[...new Set([...base.observations,...base.independent].map(o=>o.index))];
 if(!indexes.length||indexes.length>4||base.nativeScaleReview)throw Error('alternate-code-budget-or-scale');
 const crops=base.readings.filter(r=>r.engine==='paddle'&&indexes.includes(r.index));
 if(crops.length!==indexes.length*2||indexes.some(index=>[.45,.75].some(p=>crops.filter(r=>r.index===index&&r.padding===p).length!==1)))
  throw Error('alternate-code-crop-coverage');
 const raw=await sharp(bytes,{limitInputPixels:30_000_000}).rotate().toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true});
 if(raw.info.width!==base.sourceDimensions.width||raw.info.height!==base.sourceDimensions.height)
  throw Error('alternate-code-dimensions');
 const rows=[];
 for(const r of crops){
  const cropBytes=await sharp(raw.data,{raw:raw.info}).extract(r.crop).png().toBuffer();
  const observed=await reader.readLine(cropBytes);
  if(!Number.isFinite(observed.confidence)||observed.confidence<0||observed.confidence>1)throw Error('alternate-code-confidence');
  rows.push({index:r.index,padding:r.padding,crop:{...r.crop},cropSha256:hash(cropBytes),confidence:observed.confidence,
   ...parseCompletePrintedCodes(observed.text||'',base.expectedPrefix)});
 }
 if(digest(read)!==digest(base))throw Error('alternate-code-base-changed');
 const report={schemaVersion:1,recipe,completed:true,
  modelSha256,photoSha256,baseReadSha256:digest(base),rows,
  mayAssignNumber:false,mayClearCodeConflict:false};
 fresh.set(report,{seal:digest(report),rows:structuredClone(rows)});return report;
}

export const observeCodeModel=input=>observeModel({...input,modelSha256:CHINESE_BODY_MODEL_SHA256,recipe:'chinese-model-original-code-crops-v1'});
const prefixFresh=new WeakMap();
export async function observePrefixCodeReview({source,read,priorReview,reader}){
 const priorRows=codeModelReviewEvidence(priorReview,read,hash(source));
 if(priorReview?.modelSha256!==CHINESE_BODY_MODEL_SHA256||!prefixReviewSeed(read,priorRows))
  throw Error('prefix-review-not-eligible');
 const priorSeal=digest(priorReview);
 const report=await observeModel({source,read,reader,modelSha256:SERVER_CODE_MODEL_SHA256,recipe:'prefix-only-server-original-crops-v1'});
 if(!codeModelReviewEvidence(priorReview,read,hash(source))||digest(priorReview)!==priorSeal)throw Error('prefix-review-prior-changed');
 // Separate ledger: a server observation cannot masquerade as the V4 review.
 fresh.delete(report);
 report.priorReviewSha256=priorSeal;
 prefixFresh.set(report,{seal:digest(report),rows:structuredClone(report.rows)});
 return report;
}
export function prefixCodeReviewEvidence(report,priorReview,read,photoSha256){
 const saved=report&&prefixFresh.get(report),priorRows=codeModelReviewEvidence(priorReview,read,photoSha256);
 if(!saved||saved.seal!==digest(report)||report.photoSha256!==photoSha256||report.baseReadSha256!==digest(read)
   ||report.priorReviewSha256!==digest(priorReview)||priorReview.modelSha256!==CHINESE_BODY_MODEL_SHA256)return null;
 const support=prefixReviewSupport(read,priorRows,saved.rows);
 return support?{...support,modelReviewSha256:digest(priorReview),prefixReviewSha256:digest(report)}:null;
}

export async function collectCodeModelReviews({appRoot,items,onProgress=null}){
 if(!items.length)return {attempted:0,completed:0,failed:0};
 let reader;const summary={attempted:items.length,completed:0,failed:0};
 try{
  reader=await createChineseBodyReader(appRoot,path.join(appRoot,'models/paddleocr-zh-v4'));
  for(const item of items){
   try{
    const source=fs.readFileSync(item.file);
    const report=await observeCodeModel({source,read:item.detectedCodeRead,reader});
    if(hash(fs.readFileSync(item.file))!==report.photoSha256)throw Error('alternate-code-photo-changed');
    item.alternateCodeReview=report;summary.completed++;
   }catch{item.alternateCodeReview={completed:false,errorCode:'alternate-code-observation-unavailable'};summary.failed++;}
   onProgress?.(`编号模型补充读取：${summary.completed+summary.failed}/${summary.attempted} 张；保留原始异读，仍需正文与页面复核。`);
  }
 }catch{summary.failed=summary.attempted-summary.completed;}
 finally{if(reader)await reader.release();}
 const pending=items.filter(item=>prefixReviewSeed(item.detectedCodeRead,
  codeModelReviewEvidence(item.alternateCodeReview,item.detectedCodeRead,item.sourceSha256)));
 const prefix={attempted:pending.length,completed:0,failed:0};
 let server;
 try{
  if(pending.length)server=await createServerCodeReader(appRoot);
  for(const item of pending){
   try{
    const source=fs.readFileSync(item.file);
    const report=await observePrefixCodeReview({source,read:item.detectedCodeRead,priorReview:item.alternateCodeReview,reader:server});
    if(hash(fs.readFileSync(item.file))!==report.photoSha256)throw Error('prefix-photo-changed');
    item.prefixCodeReview=report;prefix.completed++;
   }catch{item.prefixCodeReview={completed:false,errorCode:'prefix-code-observation-unavailable'};prefix.failed++;}
   onProgress?.(`编号前缀补充核验：${prefix.completed+prefix.failed}/${prefix.attempted} 张；仍须当前 PDF 正文确认，不修改原始读数。`);
  }
 }catch{
  for(const item of pending){item.prefixCodeReview={completed:false,errorCode:'prefix-code-model-unavailable'};}
  prefix.failed=prefix.attempted;
  onProgress?.('本地前缀补充模型不可用；已确认照片不受影响，疑难照片保留待复核。');
 }finally{if(server)await server.release();}
 summary.prefixReview=prefix;
 return summary;
}
