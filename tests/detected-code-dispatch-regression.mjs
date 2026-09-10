import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {recognizePreparedImage, photoCodeAuditBlockReason,summarizeDetectedCodeRead,
  isLikelyScene,recheckReliablePhotoClaimsWithPdf,auditExistingNumericPhotoCode} from '../src/photo-prepare.mjs';
const sharp=createRequire(import.meta.url)('sharp');

test('detected complete lines are read before unverified fixed strips can truncate them',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-line-dispatch-'));
  try {
    const file=path.join(dir,'synthetic.png');
    fs.writeFileSync(file,await sharp({create:{width:1000,height:750,channels:3,background:'white'}}).png().toBuffer());
    let detectedCalls=0,narrowCalls=0;
    const observations=['paddle','tesseract'].flatMap(engine=>[.45,.75].map(padding=>({
      engine,prefix:'269',number:168,fullCode:'269-1-168',confidence:engine==='paddle'?.99:90,
      index:0,padding,crop:{left:500,top:300,width:180,height:25},physicalCodeExtent:'unverified',
    })));
    const result=await recognizePreparedImage({recognize:async()=>{throw Error('legacy reader must not run');}},
      file,'269',new Set([168]),dir,'synthetic-app',{
        detectedCodeServices:{read:async()=>{detectedCalls++;return {
          regions:1,observations:observations.filter(o=>o.engine==='paddle'),
          independent:observations.filter(o=>o.engine==='tesseract'),errors:0,incompleteTailObserved:false,
          sourceDimensions:{width:1000,height:750},engines:2,
          coverage:{kind:'detected-horizontal-regions',eligibleRegions:1,processedRegions:1,completed:true},
          confirmed:168,bindingVerified:false,
        };}},
        portableOcrServices:{verifyAssets:()=>({available:true}),recognizeLine:async()=>{
          narrowCalls++;return {text:'269-1-16',confidence:.99};
        }},
      });
    assert.equal(detectedCalls,1);
    assert.equal(narrowCalls,0,'a fixed strip is not needed after independent complete-line consensus');
    assert.equal(result.number,168);assert.equal(result.reliable,true);
    assert.equal(photoCodeAuditBlockReason(result),null);
    assert.equal(result.detectedCodeRead.bindingVerified,false,'reading is not order binding');
    assert.equal(result.evidence.observations.length,4);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

function completeRead() {
  const rows=['paddle','tesseract'].flatMap(engine=>[.45,.75].map(padding=>({engine,index:0,padding,
    prefix:'269',number:168,fullCode:'269-1-168',confidence:engine==='paddle'?.99:90,
    crop:{left:10,top:10,width:100,height:20},physicalCodeExtent:'unverified'})));
  return {observations:rows.filter(o=>o.engine==='paddle'),independent:rows.filter(o=>o.engine==='tesseract'),
    regions:1,sourceDimensions:{width:1000,height:750},engines:2,errors:0,
    coverage:{kind:'detected-horizontal-regions',eligibleRegions:1,processedRegions:1,completed:true},
    incompleteTailObserved:false,bindingVerified:false,expectedPrefix:'269'};
}
test('detected consensus cannot hide contrary, incomplete, low-score or foreign-prefix observations',()=>{
  for(const mutate of [
    r=>r.observations.push({...r.observations[0],fullCode:'269-1-169',number:169,confidence:.1}),
    r=>r.independent.push({...r.independent[0],fullCode:'268-1-168',prefix:'268',confidence:1}),
    r=>r.errors=1,r=>r.coverage.completed=false,r=>r.incompleteTailObserved=true,
    r=>r.independent=[],r=>r.independent.forEach(o=>o.confidence=1),
    r=>r.independent.forEach(o=>o.crop=null),r=>r.observations[0].fullCode='269-1-169',
    r=>r.independent.forEach(o=>o.padding+=1),r=>r.independent[0].crop.width=-1,
    r=>r.independent[0].crop.left=10000,r=>r.independent[0].index=3,
    r=>r.coverage.processedRegions=0,r=>r.sourceDimensions=null,r=>r.engines=1,
    r=>r.independent[0].confidence=101,r=>r.observations[0].confidence=100,
  ]) {
    const read=completeRead();mutate(read);read.confirmed=168;
    const review=summarizeDetectedCodeRead(read,'269',new Set([168]));
    assert.equal(review.number,null,'recompute support instead of trusting a saved confirmed field');
    assert.ok(review.reason);
  }
  assert.equal(summarizeDetectedCodeRead(completeRead(),'269',new Set([169])).reason,'detected-code-outside-pdf');
});
test('detected input evidence remains separate from changed proposals, PDF/body gates and scene guesses',async()=>{
  const read=completeRead(),review=summarizeDetectedCodeRead(read,'269',new Set([168]));
  const item={file:'not-read.jpg',reliable:true,number:168,evidence:review.evidence,detectedCodeRead:read,candidates:[]};
  assert.equal(photoCodeAuditBlockReason(item),null);assert.equal(isLikelyScene(item),false);
  const retained=JSON.stringify(read);
  item.number=169;assert.ok(photoCodeAuditBlockReason(item));
  assert.equal(JSON.stringify(read),retained);
  item.number=168;
  const noPage=await recheckReliablePhotoClaimsWithPdf([item],[{number:169,_localShapeFingerprint:[1]}]);
  assert.equal(noPage.confirmed,0,'a correctly read code cannot skip the unique PDF-page gate');
  item.reliable=true;item.bodyReviewHistory=[{status:'conflicting-body-evidence'}];
  assert.ok(photoCodeAuditBlockReason(item),'body conflict still vetoes code consensus');
});

test('rechecking an already numbered photo uses the same detector evidence as a new photo, not its filename',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-numbered-dispatch-'));
  try {
    const file=path.join(dir,'169.jpg');
    fs.writeFileSync(file,await sharp({create:{width:1000,height:750,channels:3,background:'white'}}).jpeg().toBuffer());
    const original=fs.readFileSync(file);
    let detectedCalls=0;
    const result=await auditExistingNumericPhotoCode({appRoot:'synthetic-app',file,expectedPrefix:'269',
      expectedNumbers:new Set([168,169]),cropDir:dir,
      worker:{recognize:async()=>{throw Error('legacy strips must not run');}},
      detectedCodeServices:{read:async()=>{detectedCalls++;return completeRead();}},
    });
    assert.equal(detectedCalls,1,'already numbered input must not fall back to a Windows-only pipeline');
    assert.equal(result.number,168,'169.jpg is only a filename claim');
    assert.equal(result.reliable,true);
    assert.equal(result.detectedCodeRead.observations.length,2);
    assert.deepEqual(fs.readFileSync(file),original,'recheck does not rename or overwrite the photo');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
