import crypto from 'node:crypto';
import {parseCompletePrintedCodes} from './printed-code-parser.mjs';

const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const validSource=value=>validHash(value?.pdfSha256)&&Number.isInteger(value?.pageNumber)&&value.pageNumber>0;
const digest=evidence=>sha256(JSON.stringify({schemaVersion:evidence.schemaVersion,recipe:evidence.recipe,
  pdfSha256:evidence.pdfSha256,pageNumber:evidence.pageNumber,observations:evidence.observations}));

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
  if(status==='skipped'?!validHash(sourceCropSha256):!validHash(cropSha256))throw Error('Missing exact PDF crop identity');
  const confidence=status==='ok'?(input.confidence??null):null;
  const confidenceScale=confidence===null?null:input.confidenceScale;
  if(confidence!==null&&(!Number.isFinite(confidence)||![1,100].includes(confidenceScale)
    ||confidence<0||confidence>confidenceScale))throw Error('Invalid PDF OCR confidence');
  const text=status==='ok'?String(input.text??''):'';
  const parsed=parseCompletePrintedCodes(text);
  const errorCode=status==='ok'?null:input.errorCode;
  if(status!=='ok'&&!['ocr-failed','ocr-unavailable','crop-normalization-failed','no-result'].includes(errorCode))throw Error('Invalid PDF OCR outcome');
  const modelSha256=input.modelSha256??null;
  if(modelSha256!==null&&!validHash(modelSha256))throw Error('Invalid PDF OCR model hash');
  evidence.observations.push({sequence:evidence.observations.length+1,engine,layout,status,cropSha256,
    sourceCropSha256,modelSha256,confidence,confidenceScale,errorCode,
    blank:status==='ok'?text.trim().length===0:null,
    incompleteTailObserved:parsed.incompleteTailObserved,codes:parsed.codes});
  evidence.digest=digest(evidence);
  return evidence;
}

// Detect stale/mixed source pages and accidental mutations of the private
// ledger. This checksum is not a signature and cannot establish OCR truth.
export function validatePdfPrintCodeEvidence(evidence,source) {
  return Boolean(validSource(source)&&validSource(evidence)&&evidence.schemaVersion===1
    &&evidence.recipe==='pdf-code-observations-v1'&&evidence.mayAuthorizeUpload===false
    &&source.pdfSha256===evidence.pdfSha256&&source.pageNumber===evidence.pageNumber
    &&Array.isArray(evidence.observations)&&evidence.digest===digest(evidence));
}
