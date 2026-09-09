import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import * as photo from '../src/photo-prepare.mjs';

const scene={paperGeometry:{usablePaper:false,rectangularPaper:false,width:.65},
  visualMetrics:{edgeDensity:.08,upperEdgeDensity:.04},
  sceneMetrics:{darkRatio:.7,luminance:55,warmBrightRatio:.08,flameStructure:{distributed:true}}};
const observed=(fullCode='269-1-68')=>({fullCode,prefix:fullCode.split('-')[0],
  number:Number(fullCode.split('-')[2]),expectedPrefix:'269',fullCodeValidated:true,
  prefixDistance:fullCode.startsWith('269-')?0:null,
  engine:'paddle',crop:'local-ocr-grid0-line-000:color',confidence:60,modelSha256:'synthetic-model'});
const partial={status:'unresolved',expectedPrefix:'269',observations:[observed()],
  incompleteTailObserved:false,errorCode:null,coverage:{kind:'fixed-narrow-grid',completed:true}};
// First assertion fails on the old product: no consensus was confused with
// exclusion of every printed code, so a retained single reading lost to colour.
assert.equal(photo.isLikelyScene({...scene,portableCodeRead:partial}),false,
  'a complete code without consensus must not become a scene');
for(const read of [partial,{...partial,observations:[],errorCode:'portable-reader-unavailable'},
  {...partial,observations:[],coverage:{kind:'fixed-narrow-grid',completed:false}},
  {...partial,observations:[],incompleteTailObserved:true}]) {
  assert.equal(photo.canUseSceneAfterPortableRead(read),false);
  assert.equal(photo.isLikelyScene({...scene,portableCodeRead:read}),false);
}
assert.equal(photo.canUseSceneAfterPortableRead(null),false);
const empty={...partial,status:'no-complete-code',observations:[]};
assert.equal(photo.canUseSceneAfterPortableRead(empty),true,
  'a completed grid may use the existing scene heuristic, not prove a scene');

const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-portable-retention-'));
try {
  const sharp=createRequire(import.meta.url)('sharp');
  const file=path.join(scratch,'synthetic.png');
  fs.writeFileSync(file,await sharp({create:{width:1000,height:1000,channels:3,background:'white'}}).png().toBuffer());
  const args={appRoot:null,file,metadata:{width:1000,height:1000},paperGeometry:{},
    expectedPrefix:'269',expectedNumbers:new Set([68]),cropDir:scratch};
  const collect=async(results,overrides={})=>{
    let calls=0;
    return photo.recognizeWithPortableLocalOcr(args,{
      verifyAssets:()=>({available:true,modelSha256:'synthetic-model'}),
      extractCrop:async()=>Buffer.from('synthetic crop'),
      recognizeLine:async()=>{
        const value=results[calls++] || {text:'',confidence:0};
        if(value instanceof Error)throw value;
        return value;
      },...overrides,
    });
  };
  const one=await collect([{text:'269-1-68',confidence:.6}]);
  assert.equal(one.number,null);
  assert.equal(one.portableCodeRead.observations.length,1);
  assert.equal(one.portableCodeRead.coverage.completed,true);
  assert.equal(one.portableCodeRead.observations[0].confidence,60);
  const firstLayout=photo.localOcrCodeLayoutsForPhoto({})[0];
  assert.deepEqual(one.portableCodeRead.sourceDimensions,{width:1000,height:1000});
  assert.deepEqual(one.portableCodeRead.observations[0].cropBounds,{
    left:Math.floor(firstLayout.left*1000),top:Math.floor(firstLayout.top*1000),
    width:Math.floor(firstLayout.width*1000),height:Math.floor(firstLayout.height*1000)});
  assert.equal(one.portableCodeRead.observations[0].physicalCodeExtent,'unverified',
    'a complete OCR string does not prove the crop contains every printed character');
  assert.ok(one.portableCodeRead.readCount>1);
  assert.equal(one.portableCodeRead.emptyReadCount,one.portableCodeRead.readCount-1);
  assert.equal(photo.portableCodeIssueCategory({reliable:false,portableCodeRead:one.portableCodeRead}),'unconfirmed');

  for(const text of ['268-1-68','269-1-99','269-1-6800']) {
    const result=await collect([{text,confidence:.95}]);
    assert.equal(result.number,null,'do not filter or repair a complete outside code');
    assert.equal(result.blocked,true);
    assert.equal(result.portableCodeRead.observations[0].fullCode,text);
    assert.equal(result.portableCodeRead.coverage.completed,false);
    assert.equal(photo.portableCodeIssueCategory({reliable:false,portableCodeRead:result.portableCodeRead}),
      text.startsWith('268')?'conflicting':'outside-pdf');
  }
  // A low model score cannot erase a full contrary observation before the
  // next normalised view is considered. Scores are not correct probabilities.
  const mixed=await collect([{text:'269-1-68',confidence:.9},{text:'268-1-68',confidence:.2}]);
  assert.equal(mixed.number,null);
  assert.deepEqual(mixed.portableCodeRead.observations.map(x=>x.fullCode),['269-1-68','268-1-68']);
  assert.equal(mixed.portableCodeRead.observations[1].confidence,20);
  const failed=await collect([{text:'269-1-68',confidence:.6},new Error('do not retain private exception text')]);
  assert.equal(failed.portableCodeRead.observations.length,1);
  assert.equal(failed.portableCodeRead.errorCode,'portable-reader-unavailable');
  assert.equal(failed.number,null);
  assert.equal(failed.blocked,true);
  assert.ok(!JSON.stringify(failed).includes('private exception'));
  assert.equal(photo.portableCodeIssueCategory({reliable:false,portableCodeRead:failed.portableCodeRead}),'unavailable');
  const unavailable=await collect([],{verifyAssets:()=>({available:false})});
  assert.equal(unavailable.portableCodeRead.status,'unavailable');
  assert.equal(photo.canUseSceneAfterPortableRead(unavailable.portableCodeRead),false);
  const blank=await collect([{text:'synthetic private body',confidence:.9}]);
  assert.equal(blank.portableCodeRead.status,'no-complete-code');
  assert.ok(!JSON.stringify(blank.portableCodeRead).includes('private body'));
  const split=await collect([{text:'269-1-6 8',confidence:.9}]);
  assert.equal(split.number,null);
  assert.equal(split.portableCodeRead.incompleteTailObserved,true);
  assert.equal(photo.portableCodeIssueCategory({reliable:false,portableCodeRead:split.portableCodeRead}),'incomplete');

  // Repeated tails are ONE model's weak readings, not a complete printed code.
  // The prior collector promoted three agreeing partial crops to direct code
  // evidence even though its strict complete-code observation list was empty.
  args.expectedNumbers.add(168);
  const tailConsensus=await collect([], {recognizeLine:async()=>({text:'168',confidence:.63})});
  assert.equal(tailConsensus.number,null,'repeated tail-only reads must not become a reliable full-code proposal');
  assert.equal(tailConsensus.portableCodeRead.observations.length,0);
  assert.equal(tailConsensus.portableCodeRead.partialCodeObserved,true);
  assert.ok(tailConsensus.candidates.some(c=>c.number===168),'retain the weak diagnostic candidate');
  assert.equal(photo.canUseSceneAfterPortableRead(tailConsensus.portableCodeRead),false,
    'rejecting weak numbering is not permission to relabel the paper as a scene');
  assert.equal(photo.portableCodeIssueCategory({reliable:false,portableCodeRead:tailConsensus.portableCodeRead}),'incomplete');

  const good=await collect([{text:'269-1-68',confidence:.9},{text:'269-1-68',confidence:.9}]);
  assert.equal(good.number,68);
  assert.equal(good.portableCodeRead.observations.length,2);
  assert.equal(good.portableCodeRead.coverage.completed,false,'fast success is not a full grid search');
  const proposal={file:'not-read.jpg',number:68,reliable:true,evidence:good.evidence,candidates:good.candidates};
  const retained=photo.retainPortableCodeRead({...proposal},one.portableCodeRead);
  assert.equal(retained.number,68,'a later valid same-code reader can corroborate a single observation');
  assert.equal(photo.photoCodeAuditBlockReason(retained),null);
  assert.equal(photo.portableCodeIssueCategory(retained),null);
  retained.number=69;
  assert.ok(photo.photoCodeAuditBlockReason(retained),'later reassignment must still respect the original reading');
  const unresolved=photo.retainPortableCodeRead({...scene,file:'not-read.jpg',number:null,reliable:false},one.portableCodeRead);
  const saved=JSON.stringify(unresolved.codeAuditHistory);
  one.portableCodeRead.observations[0].fullCode='269-1-69';
  assert.equal(JSON.stringify(unresolved.codeAuditHistory),saved,'retain an independent copy');
  unresolved.number=68;unresolved.reliable=true;unresolved.evidence=good.evidence;
  assert.ok(photo.photoCodeAuditBlockReason(unresolved),'renaming a method cannot clear unresolved history');
  assert.equal(photo.isLikelyScene(unresolved),false);
  assert.deepEqual(photo.resolveAmbiguousPhotosByGlobalSet([unresolved],new Set([68]),new Set()),[]);
  assert.equal((await photo.recheckReliablePhotoClaimsWithPdf([unresolved],[{number:68,_localShapeFingerprint:[1]}])).confirmed,0);

  // Exercise actual prepared-image dispatch, including real decode/geometry:
  // the contradictory portable read cannot be overwritten by a legacy reader.
  let legacyCalls=0;
  const dispatched=await photo.recognizePreparedImage({recognize:async()=>{legacyCalls++;throw Error('must not reach');}},
    file,'269',new Set([68]),scratch,'synthetic-app',{
      portableOcrServices:{verifyAssets:()=>({available:true}),
        recognizeLine:async()=>({text:'268-1-68',confidence:.9})},
    });
  assert.equal(legacyCalls,0);
  assert.equal(dispatched.reliable,false);
  assert.equal(dispatched.portableCodeRead.observations[0].fullCode,'268-1-68');
  assert.ok(dispatched.codeAuditHistory.length);
  for(const number of [68,69]) {
    const next=photo.retainPortableCodeRead({...proposal,number},partial);
    assert.equal(next.reliable,number===68,'all legacy success paths must be compared with retained complete codes');
  }
  const invalid=structuredClone(partial);
  invalid.observations[0].fullCode='269-1-67';
  assert.ok(photo.photoCodeAuditBlockReason({...proposal,portableCodeRead:invalid}));
  assert.deepEqual(fs.readdirSync(scratch),['synthetic.png']);
} finally { fs.rmSync(scratch,{recursive:true,force:true}); }
console.log('Portable code observation retention regression PASS');
