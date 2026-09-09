import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import * as photo from '../src/photo-prepare.mjs';

// An actual replay had four votes for one code and one exact-prefix contrary
// vote. The old PDF fast path silently confirmed the majority candidate.
const paper={usablePaper:true,rectangularPaper:true,width:.7,height:.6};
const evidence={method:'paddleocr-onnx-adaptive-right-line-consensus',votes:4,prefixDistance:0,maxConfidence:89};
const candidates=[{number:55,votes:4,prefixDistance:0,maxConfidence:89},{number:53,votes:1,prefixDistance:0,maxConfidence:71}];
const conflicting={file:'not-read.jpg',number:55,reliable:true,paperGeometry:paper,evidence:{...evidence},candidates};
const checked=await photo.recheckReliablePhotoClaimsWithPdf([conflicting],[{number:55,_localShapeFingerprint:[1]}]);
assert.equal(checked.confirmed,0,'exact-prefix contrary evidence must not disappear at the PDF fast path');
assert.equal(conflicting.reliable,false);
assert.equal(conflicting.pdfRecheck.reason,'strong-code-candidates-conflict');
assert.equal(checked.inconclusive,1,'ambiguity is retained without blocking unrelated confirmed photos');

// The one-anchor template run used to bypass the conflict check applied to
// the other sequence paths. A missing slot is not new recognition evidence.
const template={...paper,score:.3,boxArea:.5,fill:.8,top:.2};
const sequenceItem=(number,index)=>({file:`微信图片_2026030112000${index}_sequence.jpg`,number,reliable:Number.isInteger(number),
  paperGeometry:{...template},visualMetrics:{edgeDensity:.2},evidence:{...evidence},candidates:[]});
const run=[sequenceItem(65,0),sequenceItem(null,1),sequenceItem(null,2)];
run[1].candidates=[{number:99,votes:2,prefixDistance:0,maxConfidence:85}];
photo.inferPhotoSequences(run,new Set([65,66,67]));
assert.equal(run[1].number,null,'one-anchor sequence must respect contrary OCR as well');
assert.equal(run[2].number,null,'do not infer the rest of a run across an unresolved contradiction');

const obs=(number,engine,crop)=>({number,engine,crop,fullCodeValidated:true,prefixDistance:0});
const agreed=['paddle','tesseract'].flatMap(engine=>['a','b'].map(crop=>obs(68,engine,crop)));
const create=()=>({file:'not-read.jpg',number:68,reliable:true,paperGeometry:paper,evidence:{...evidence},
  candidates:[{number:66,votes:2,prefixDistance:0,maxConfidence:80}]});
for(const audit of [
  {number:null,observations:[...agreed.map(x=>({...x})),obs(66,'windows','c')]},
  {number:null,observations:[]},
  {number:null,observations:[],errorCode:'independent-reader-unavailable'},
  {number:null,observations:agreed.map(x=>({...x,number:9999}))},
]) {
  const item=create();
  photo.recordIndependentCodeAudit(item,audit,new Set([66,68]));
  assert.equal(item.reliable,false);
  assert.equal(item.number,null);
  const saved=JSON.stringify(item.codeAuditHistory);
  const reason=photo.photoCodeAuditBlockReason(item);
  assert.ok(reason);
  // Later mutation of an OCR result must not mutate the retained history.
  if(audit.observations[0])audit.observations[0].number=1;
  assert.equal(JSON.stringify(item.codeAuditHistory),saved);
  assert.equal(photo.isLikelyScene({...item,visualMetrics:{edgeDensity:.01},sceneMetrics:{darkRatio:.9}}),false);
  assert.deepEqual(photo.resolveAmbiguousPhotosByGlobalSet([item],new Set([66,68]),new Set([68])),[]);
  assert.equal(item.number,null,'remaining PDF slots cannot turn a failed audit into a new number');
  const frame=(number,index)=>({file:`微信图片_2026030112000${index}_frame.jpg`,number,reliable:true,paperGeometry:{...paper,score:.3,boxArea:.5,fill:.8},
    evidence:{...evidence},visualMetrics:{edgeDensity:.2}});
  item.file='微信图片_20260301120001_conflict.jpg';
  const sequence=[frame(65,0),item,frame(67,2),frame(68,3)];
  photo.inferPhotoSequences(sequence,new Set([65,66,67,68]));
  photo.inferPhotoGapsAroundExistingNumbers(sequence,new Set([65,66,67,68]));
  assert.equal(item.number,null,'sequence and gap inference cannot erase a failed audit');
  assert.equal(photo.hasStrongOcrConflict(item,66,new Set([68])),true,'occupied numbers cannot cancel the audit');
  const duplicate={...item,number:68,reliable:true};
  assert.deepEqual(photo.reconcileDuplicatePhotoNumbers([frame(68,0),duplicate],new Set([66,68])),[]);
  assert.deepEqual(await photo.reconcileDuplicatePhotoNumbersByPdfStructure([frame(68,0),duplicate],
    [{number:68,portrait:false},{number:66,portrait:true}],new Set([66,68])),[]);
  assert.equal((await photo.matchPdfPagesLocally([item],[{number:66,_localShapeFingerprint:[1]}])).attempted,0);
  // A later method rename / speculative assignment does not clear history.
  item.number=68;item.reliable=true;item.evidence={...evidence,method:'global-one-to-one-remaining-pdf-candidate'};
  const result=await photo.recheckReliablePhotoClaimsWithPdf([item],[{number:68,_localShapeFingerprint:[1]}]);
  assert.equal(result.confirmed,0);
  assert.equal(item.pdfRecheck.reason,reason);
  assert.equal(item.reliable,false);
  assert.equal(JSON.stringify(item.codeAuditHistory),saved);
}

const good={...create(),candidates:[]};
photo.recordIndependentCodeAudit(good,{number:68,observations:agreed},new Set([68]));
assert.equal(photo.photoCodeAuditBlockReason(good),null);
assert.equal(good.number,68);
assert.equal(good.reliable,true);
assert.equal((await photo.recheckReliablePhotoClaimsWithPdf([good],[{number:68,_localShapeFingerprint:[1]}])).confirmed,1);
good.number=66;
assert.equal(photo.photoCodeAuditBlockReason(good),'independent-code-audit-number-changed');
const badSuccess={...create(),candidates:[]};
photo.recordIndependentCodeAudit(badSuccess,{number:66,observations:agreed},new Set([66,68]));
assert.equal(badSuccess.reliable,false,'returned number must match the independent observations');
const retry={...create(),candidates:[]};
photo.recordIndependentCodeAudit(retry,{number:null,observations:[]},new Set([68]));
photo.recordIndependentCodeAudit(retry,{number:68,observations:agreed},new Set([68]));
assert.equal(retry.codeAuditHistory.length,2);
assert.equal(retry.reliable,false,'a new code-only proposal cannot erase unresolved earlier review');

// Exercise the real async collector, with synthetic reader results. The first
// result must survive a later reader exception; no OCR accuracy is claimed.
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-code-audit-test-'));
try {
  const sharp=createRequire(import.meta.url)('sharp');
  const file=path.join(scratch,'synthetic.png');
  fs.writeFileSync(file,await sharp({create:{width:1000,height:1000,channels:3,background:'white'}}).png().toBuffer());
  const seed=photo.localOcrCodeLayoutsForPhoto({})[0].name;
  let reads=0;
  const result=await photo.auditConflictingPhotoCode({appRoot:null,expectedPrefix:'269',expectedNumbers:new Set([68]),cropDir:scratch,
    item:{file,paperGeometry:{},evidence:{successfulCropNames:[seed]}},
    worker:{recognize:async()=>{if(++reads>1)throw Error('synthetic reader failure');return {data:{text:'269-1-68'}};}}});
  assert.equal(result.errorCode,'independent-reader-unavailable');
  assert.equal(result.number,null);
  assert.equal(result.observations.length,1);
  assert.equal(result.observations[0].number,68);
  assert.equal(result.observations[0].engine,'tesseract');
  assert.deepEqual(fs.readdirSync(scratch),['synthetic.png']);
} finally { fs.rmSync(scratch,{recursive:true,force:true}); }
console.log('Photo code audit retention regression PASS');
