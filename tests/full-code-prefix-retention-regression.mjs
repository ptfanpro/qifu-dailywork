import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import * as photo from '../src/photo-prepare.mjs';

const readings=(...texts)=>texts.map((text,index)=>({crop:`crop-${index}`,text}));
// Reproduces a missing part of the old contrary-code guard: a foreign prefix
// vanished before consensus even when its tail was identical to the majority.
const mixed=photo.summarizeWindowsCodeObservations(readings('269-1-68','269-1-68','268-1-68'),'269');
assert.equal(mixed.reliable,false,'do not filter a different complete month prefix before consensus');
assert.deepEqual(new Set(mixed.observations.map(o=>o.fullCode)),new Set(['269-1-68','268-1-68']));
assert.ok(mixed.codeAuditHistory.length);
const item={...mixed,file:'never-read.jpg',number:68,reliable:true,evidence:{method:'later-code-proposal'}};
assert.ok(photo.photoCodeAuditBlockReason(item),'later filename/number proposals cannot erase a prefix conflict');
assert.equal(photo.isLikelyScene({...item,sceneMetrics:{darkRatio:.99}}),false);
assert.equal((await photo.recheckReliablePhotoClaimsWithPdf([item],[{number:68,_localShapeFingerprint:[1]}])).confirmed,0);

const parsed=photo.parseCompletePrintedCodes('269-1-68 268-1-68 281-1-68','269');
assert.deepEqual(parsed.numbers,[68]);
assert.deepEqual(parsed.codes.map(c=>c.fullCode),['269-1-68','268-1-68','281-1-68']);
assert.deepEqual(photo.parseCompletePrintedCodes('269-1-6 8','269').codes,[]);
assert.deepEqual(photo.parseCompletePrintedCodes('269-168','269').codes,[]);
for(let month=1;month<=12;month++) {
  const prefix=`26${month}`;
  const good=photo.summarizeWindowsCodeObservations(readings(`${prefix}-1-1234`,`${prefix} · 1 · 1234`),prefix);
  assert.equal(good.number,1234);
  assert.equal(good.prefixConflict,false);
  assert.equal(good.observations[0].expectedPrefix,prefix);
}
const observation=(prefix,engine,crop)=>({fullCode:`${prefix}-1-68`,prefix,expectedPrefix:'269',
  number:68,engine,crop,fullCodeValidated:true,prefixDistance:prefix==='269'?0:null});
const good=['paddle','tesseract'].flatMap(engine=>['a','b'].map(crop=>observation('269',engine,crop)));
assert.equal(photo.independentCodeConsensus(good),68);
const observations=[...good,observation('268','windows','c')];
assert.equal(photo.independentCodeConsensus(observations),null);
assert.equal(photo.independentCodeConsensus([...good,{...observation('268','windows','c'),prefixDistance:0}]),null,
  'a stale prefixDistance cannot rewrite the actual full code');
assert.equal(photo.independentCodeConsensus(good.map(o=>({...o,fullCode:'269-1-67'}))),null,
  'full code must match the stored tail');
const audited={number:68,reliable:true};
photo.recordIndependentCodeAudit(audited,{number:68,observations},new Set([68]));
assert.equal(audited.number,null);
assert.equal(audited.codeAuditHistory[0].reason,'independent-code-audit-prefix-conflict');
assert.equal(audited.codeAuditHistory[0].observations.at(-1).fullCode,'268-1-68');
observations.at(-1).fullCode='269-1-68';
assert.equal(audited.codeAuditHistory[0].observations.at(-1).fullCode,'268-1-68','history is a cloned observation');
photo.recordIndependentCodeAudit(audited,{number:68,observations:good},new Set([68]));
assert.equal(audited.reliable,false,'a later consensus cannot erase the earlier full-prefix conflict');

// Exercise the real asynchronous collector, not just a fabricated history.
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-prefix-retention-'));
try {
  const sharp=createRequire(import.meta.url)('sharp');
  const file=path.join(scratch,'synthetic.png');
  fs.writeFileSync(file,await sharp({create:{width:1000,height:1000,channels:3,background:'white'}}).png().toBuffer());
  const seed=photo.localOcrCodeLayoutsForPhoto({})[0].name;
  let calls=0;
  const result=await photo.auditConflictingPhotoCode({appRoot:null,expectedPrefix:'269',expectedNumbers:new Set([68]),cropDir:scratch,
    item:{file,paperGeometry:{},evidence:{successfulCropNames:[seed]}},
    worker:{recognize:async()=>{if(++calls>1)throw Error('synthetic reader failure');return {data:{text:'268-1-68'}};}}});
  assert.equal(result.errorCode,'independent-reader-unavailable');
  assert.equal(result.observations.length,1,'different prefix survives collection and a subsequent reader error');
  assert.equal(result.observations[0].fullCode,'268-1-68');
  assert.equal(result.number,null);
  assert.deepEqual(fs.readdirSync(scratch),['synthetic.png']);
} finally { fs.rmSync(scratch,{recursive:true,force:true}); }
console.log('Complete prefix retention regression PASS');
