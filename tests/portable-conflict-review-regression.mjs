import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {recognizeWithPortableLocalOcr,retainPortableCodeRead,photoCodeAuditBlockReason,
  canUseSceneAfterPortableRead,localOcrCodeLayoutsForPhoto} from '../src/photo-prepare.mjs';

const sharp=createRequire(import.meta.url)('sharp');
async function collect(readLine) {
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-conflict-review-'));
  try {
    const file=path.join(scratch,'generated.png');
    fs.writeFileSync(file,await sharp({create:{width:1000,height:1000,channels:3,background:'white'}}).png().toBuffer());
    let calls=0;
    const result=await recognizeWithPortableLocalOcr({appRoot:null,file,metadata:{width:1000,height:1000},
      paperGeometry:{},expectedPrefix:'269',expectedNumbers:new Set([68]),cropDir:scratch},{
      verifyAssets:()=>({available:true,modelSha256:'synthetic'}),
      extractCrop:async()=>Buffer.from('generated pixel stand-in'),
      recognizeLine:async()=>readLine(++calls),
    });
    return {result,calls};
  } finally {fs.rmSync(scratch,{recursive:true,force:true});}
}
test('first questionable narrow reading does not suppress later observations',async()=>{
  const {result:r,calls}=await collect(n=>({text:n===1?'269-1-6':'269-1-68',confidence:.9}));
  assert.ok(calls>2,'the old reader exits after the first syntactically valid but out-of-range string');
  assert.deepEqual(new Set(r.portableCodeRead.observations.map(o=>o.fullCode)),new Set(['269-1-6','269-1-68']));
  assert.equal(r.number,null,'follow-up is evidence collection, not permission to discard the first observation');
  assert.equal(r.blocked,true);
  assert.ok(r.candidates.some(c=>c.number===68),'retain later evidence for review without auto-assigning');
  assert.equal(r.portableCodeRead.conflictReview.firstReason,'portable-code-outside-pdf');
  assert.equal(r.portableCodeRead.conflictReview.stopReason,'layout-budget');
  assert.equal(r.portableCodeRead.coverage.completed,false);
  assert.equal(canUseSceneAfterPortableRead(r.portableCodeRead),false);
  const next=retainPortableCodeRead({number:68,reliable:true},r.portableCodeRead);
  assert.equal(next.number,null);
  assert.ok(photoCodeAuditBlockReason(next),'later method names may not erase unresolved observations');
});
test('bounded follow-up retains low-score foreign prefixes and repeated outside codes',async()=>{
  for(const text of ['268-1-68','269-1-6800','269-1-6 8']) {
    const {result:r,calls}=await collect(n=>({text:n===1?text:'269-1-68',confidence:n===1?.2:.9}));
    assert.ok(calls>2&&calls<=34,'at most the triggering layout plus 16 following layouts, two views each');
    assert.equal(r.number,null);
    assert.equal(r.blocked,true);
    assert.ok(r.portableCodeRead.conflictReview);
    assert.ok(r.portableCodeRead.observations.some(o=>o.fullCode==='269-1-68'));
    assert.equal(r.portableCodeRead.conflictReview.followingLayouts,16);
    assert.equal(r.portableCodeRead.conflictReview.physicalCodeExtentVerified,false);
  }
});
test('follow-up failure preserves observations and fixed error codes, not exception text',async()=>{
  const {result:r}=await collect(n=>{if(n===3)throw Error('private text must not be logged');
    return {text:n===1?'269-1-6':'269-1-68',confidence:.9};});
  assert.equal(r.portableCodeRead.status,'unavailable');
  assert.equal(r.portableCodeRead.errorCode,'portable-reader-unavailable');
  assert.equal(r.portableCodeRead.conflictReview.stopReason,'reader-error');
  assert.deepEqual(r.portableCodeRead.observations.map(o=>o.fullCode),['269-1-6','269-1-68']);
  assert.ok(!JSON.stringify(r).includes('private text'));
});
test('normal fast agreement is unchanged and blank reading does not create a conflict review',async()=>{
  const good=await collect(()=>({text:'269-1-68',confidence:.9}));
  assert.equal(good.result.number,68);assert.equal(good.calls,2);
  assert.equal(good.result.portableCodeRead.conflictReview,null);
  const blank=await collect(()=>({text:'',confidence:0}));
  assert.equal(blank.result.portableCodeRead.conflictReview,null);
  assert.equal(blank.result.portableCodeRead.coverage.completed,true);
});
test('review at the end of the grid does not invent missing reads or full-field verification',async()=>{
  const count=localOcrCodeLayoutsForPhoto({}).length;
  const {result:r,calls}=await collect(n=>({text:n===count-1?'268-1-68':'',confidence:.2}));
  assert.equal(calls,count);
  assert.equal(r.portableCodeRead.conflictReview.followingLayouts,1);
  assert.equal(r.portableCodeRead.conflictReview.stopReason,'grid-exhausted');
  assert.equal(r.portableCodeRead.coverage.completed,true);
  assert.equal(r.portableCodeRead.conflictReview.physicalCodeExtentVerified,false);
  assert.equal(r.number,null);
  assert.equal(canUseSceneAfterPortableRead(r.portableCodeRead),false);
});
