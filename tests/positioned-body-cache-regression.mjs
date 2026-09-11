import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {readBodyObservation} from '../src/body-observation-cache.mjs';
import {visualBodyViewNames} from '../src/pdf-visual-body-evidence.mjs';
import {horizontalBodyCrop,verticalBodyCrop} from '../src/vertical-body-regions.mjs';
import {validPositionedBodyViews} from '../src/body-positioned-observation.mjs';
const dims={width:1200,height:900};
function views(positions){return visualBodyViewNames.map((view,i)=>{
 const region=i<2?{left:.1,top:.1,width:.3,height:.03,score:.9}:{left:.5,top:.2,width:.02,height:.4,score:.9};
 return {view,text:'春山秋水',lineCount:1,regions:1,errors:0,truncated:false,
  ...(positions?{positioned:{schemaVersion:1,dimensions:{...dims},fields:[{regionIndex:i<2?0:1,region,text:'春山秋水',confidence:.95,
   crop:(i<2?horizontalBodyCrop:verticalBodyCrop)(region,dims,i%2===0?.35:.65)}]}}:{})};
});}
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
test('position-required cache cannot reuse a legacy pure-text entry',async()=>{
 const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-position-cache-'));
 try{
  const common={cacheDir,source:Buffer.from('synthetic pixels'),fingerprint:'a'.repeat(64),modelSha256:'b'.repeat(64)};
  await readBodyObservation({...common,read:async()=>views(false)});
  let calls=0;const options={...common,profile:'positioned-v1',read:async()=>{calls++;return views(true);}};
  const first=await readBodyObservation(options);assert.equal(first.cacheHit,false);assert.equal(calls,1);assert.ok(first.views[0].positioned);
  first.views[0].positioned.fields[0].region.left=.8;
  const again=await readBodyObservation(options);assert.equal(again.cacheHit,true);assert.equal(again.views[0].positioned.fields[0].region.left,.1);
  assert.equal((await readBodyObservation({...common,read:async()=>{throw Error('plain cache missing');}})).cacheHit,true);
  assert.equal(fs.readdirSync(cacheDir).length,2);
 }finally{fs.rmSync(cacheDir,{recursive:true,force:true});}
});
test('position schema preserves blank/partial accepted reads and rejects impossible field records',()=>{
 assert.equal(validPositionedBodyViews(views(true)),true);
 assert.equal(validPositionedBodyViews(views(true).reverse()),true);
 const blank=views(true).map(v=>({...v,text:'',lineCount:0,regions:0,positioned:{...v.positioned,fields:[]}}));
 assert.equal(validPositionedBodyViews(blank),true,'blank evidence is valid, not evidence of a page identity');
 const partial=views(true);partial[1].text='';partial[1].lineCount=0;partial[1].positioned.fields=[];
 assert.equal(validPositionedBodyViews(partial),true,'low-confidence field may be absent from one padding');
 for(const mutate of [v=>{v[0]=null;},v=>{v[1]=v[0];},v=>{v[0].regions=301;},v=>{v[2].regions=81;},
  v=>{v[1].regions=2;},v=>{v[0].lineCount=2;},v=>{v[0].positioned.fields[0].confidence=1.01;},
  v=>{v[0].positioned.fields[0].region.left=-.1;},v=>{v[0].positioned.fields[0].region.height=0;},
  v=>{v[0].positioned.fields[0].region.width=1;},v=>{v[0].positioned.fields[0].region.score=null;},
  v=>{v[0].positioned.fields[0].crop.rotation=270;},v=>{delete v[2].positioned.fields[0].crop.rotation;},
  v=>{v[0].positioned.fields[0].regionIndex=-1;},v=>{v[0].positioned.fields[0].regionIndex=1000;},
  v=>{v[0].positioned.fields.push(v[0].positioned.fields[0]);v[0].lineCount=2;v[0].regions=2;v[1].regions=2;v[0].text+='。春山秋水';},
  v=>{v.forEach(x=>x.positioned.dimensions.width=1.5);},v=>{v[0].errors=1;}]){
   const invalid=views(true);mutate(invalid);assert.equal(validPositionedBodyViews(invalid),false);
 }
});
test('position-required cache rejects malformed geometry even with a recomputed checksum',async()=>{
 const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-position-cache-invalid-'));
 try{
  let calls=0;const options={cacheDir,source:Buffer.from('synthetic pixels'),fingerprint:'a'.repeat(64),modelSha256:'b'.repeat(64),profile:'positioned-v1',read:async()=>{calls++;return views(true);}};
  await readBodyObservation(options);const file=path.join(cacheDir,fs.readdirSync(cacheDir)[0]);
  for(const mutate of [v=>{delete v[0].positioned;},v=>{v[0].positioned.fields[0].crop.left++;},v=>{v[1].positioned.dimensions.width=500;},v=>{v[0].text='不一致';},v=>{v[0].positioned.fields[0].confidence=NaN;},v=>{v[0].truncated=true;},v=>{v[1].positioned.fields[0].region.score=.8;},v=>{v[0].positioned.fields[0].regionIndex=1001;}]){
   const saved=JSON.parse(fs.readFileSync(file));mutate(saved.views);saved.viewsSha256=hash(JSON.stringify(saved.views));fs.writeFileSync(file,JSON.stringify(saved));
   const before=calls;const read=await readBodyObservation(options);assert.equal(read.cacheHit,false);assert.equal(calls,before+1);
  }
  await assert.rejects(readBodyObservation({...options,cacheDir:null,read:async()=>views(false)}),/position/i);
  await assert.rejects(readBodyObservation({...options,profile:'unknown-profile'}),/profile/i);
 }finally{fs.rmSync(cacheDir,{recursive:true,force:true});}
});
