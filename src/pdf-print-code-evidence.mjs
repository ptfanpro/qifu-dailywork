import crypto from 'node:crypto';
import {parseCompletePrintedCodes} from './printed-code-parser.mjs';

const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const validSource=value=>validHash(value?.pdfSha256)&&Number.isInteger(value?.pageNumber)&&value.pageNumber>0;
const digest=evidence=>sha256(JSON.stringify({schemaVersion:evidence.schemaVersion,recipe:evidence.recipe,
  pdfSha256:evidence.pdfSha256,pageNumber:evidence.pageNumber,observations:evidence.observations}));
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exactKeys=(value,keys)=>record(value)&&Object.keys(value).length===keys.length
  &&keys.every(key=>Object.hasOwn(value,key));
const observationKeys=['sequence','engine','layout','status','cropSha256','sourceCropSha256','modelSha256',
  'confidence','confidenceScale','errorCode','blank','incompleteTailObserved','codes'];
const evidenceKeys=['schemaVersion','recipe','pdfSha256','pageNumber','mayAuthorizeUpload','observations','digest'];
const outcomeCodes=['ocr-failed','ocr-unavailable','crop-normalization-failed','no-result'];

function validObservation(item,sequence) {
  if(!exactKeys(item,observationKeys)||item.sequence!==sequence
    ||!['tesseract','paddle','windows-ocr'].includes(item.engine)
    ||typeof item.layout!=='string'||!/^[-a-z0-9]+$/.test(item.layout)
    ||!['ok','error','skipped'].includes(item.status)
    ||!(item.sourceCropSha256===null||validHash(item.sourceCropSha256))
    ||!(item.modelSha256===null||validHash(item.modelSha256))
    ||typeof item.incompleteTailObserved!=='boolean'||!Array.isArray(item.codes))return false;
  if(item.status==='skipped'?(item.cropSha256!==null||!validHash(item.sourceCropSha256))
    :!validHash(item.cropSha256))return false;
  if(item.status!=='ok')return outcomeCodes.includes(item.errorCode)&&item.confidence===null
    &&item.confidenceScale===null&&item.blank===null&&!item.incompleteTailObserved&&item.codes.length===0;
  if(item.errorCode!==null||typeof item.blank!=='boolean')return false;
  if(item.confidence===null){if(item.confidenceScale!==null)return false;}
  else {
    const scale=item.engine==='paddle'?1:item.engine==='tesseract'?100:null;
    if(scale===null||item.confidenceScale!==scale||!Number.isFinite(item.confidence)
      ||item.confidence<0||item.confidence>scale)return false;
  }
  if(item.blank&&(item.codes.length!==0||item.incompleteTailObserved))return false;
  const seen=new Set();
  for(const code of item.codes){
    if(!exactKeys(code,['prefix','number','fullCode'])||typeof code.fullCode!=='string')return false;
    const match=/^(\d{3,4})-1-(\d{1,4})$/.exec(code.fullCode);
    // Validate internal consistency, not calendar truth: an OCR observation
    // with a suspicious prefix or leading zero must remain visible to review.
    if(!match||code.prefix!==match[1]||code.number!==Number(match[2])||code.number<=0
      ||seen.has(code.fullCode))return false;
    seen.add(code.fullCode);
  }
  return true;
}

// A lossless ledger of normalized OCR code observations, NOT a verified printed
// namespace, order binding or permission to upload. It deliberately has no
// business date / expected-prefix input, ranking or top-N truncation.
export function createPdfPrintCodeEvidence(source) {
  if(!validSource(source))throw Error('PDF print evidence requires a file hash and physical page');
  const evidence={schemaVersion:1,recipe:'pdf-code-observations-v1',pdfSha256:source.pdfSha256,
    pageNumber:source.pageNumber,mayAuthorizeUpload:false,observations:[]};
  evidence.digest=digest(evidence);
  return evidence;
}

export function appendPdfPrintCodeObservation(evidence,input) {
  if(!validatePdfPrintCodeEvidence(evidence,evidence))throw Error('Invalid PDF print evidence ledger');
  const {engine,layout,cropSha256=null,sourceCropSha256=null}=input;
  const status=input.status||'ok';
  if(!['tesseract','paddle','windows-ocr'].includes(engine)||!/^[-a-z0-9]+$/.test(layout||'')
    ||!['ok','error','skipped'].includes(status))throw Error('Invalid PDF OCR observation identity');
  if(status==='skipped'?(cropSha256!==null||!validHash(sourceCropSha256)):!validHash(cropSha256))throw Error('Missing exact PDF crop identity');
  const confidence=status==='ok'?(input.confidence??null):null;
  const confidenceScale=confidence===null?null:input.confidenceScale;
  if(confidence!==null&&(!Number.isFinite(confidence)||![1,100].includes(confidenceScale)
    ||confidence<0||confidence>confidenceScale))throw Error('Invalid PDF OCR confidence');
  const text=status==='ok'?String(input.text??''):'';
  const parsed=parseCompletePrintedCodes(text);
  const errorCode=status==='ok'?null:input.errorCode;
  if(status!=='ok'&&!outcomeCodes.includes(errorCode))throw Error('Invalid PDF OCR outcome');
  const modelSha256=input.modelSha256??null;
  if(modelSha256!==null&&!validHash(modelSha256))throw Error('Invalid PDF OCR model hash');
  const observation={sequence:evidence.observations.length+1,engine,layout,status,cropSha256,
    sourceCropSha256,modelSha256,confidence,confidenceScale,errorCode,
    blank:status==='ok'?text.trim().length===0:null,
    incompleteTailObserved:parsed.incompleteTailObserved,codes:parsed.codes};
  if(!validObservation(observation,evidence.observations.length+1))throw Error('Invalid PDF OCR observation structure');
  evidence.observations.push(observation);
  evidence.digest=digest(evidence);
  return evidence;
}

// Detect stale/mixed source pages and accidental mutations of the private
// ledger. This checksum is not a signature and cannot establish OCR truth.
export function validatePdfPrintCodeEvidence(evidence,source) {
  try {
    if(!exactKeys(evidence,evidenceKeys)||!validSource(source)||!validSource(evidence)||evidence.schemaVersion!==1
      ||evidence.recipe!=='pdf-code-observations-v1'||evidence.mayAuthorizeUpload!==false
      ||source.pdfSha256!==evidence.pdfSha256||source.pageNumber!==evidence.pageNumber
      ||!Array.isArray(evidence.observations)||!validHash(evidence.digest))return false;
    for(const [index,item] of evidence.observations.entries())if(!validObservation(item,index+1))return false;
    return evidence.digest===digest(evidence);
  } catch {
    return false;
  }
}
