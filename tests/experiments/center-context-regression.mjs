import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {centerRect,centerPixels,joinCenterContextViews,createCenterContextEncoder} from './center-context-reader.mjs';
const sharp=createRequire(import.meta.url)('sharp');
const vector=n=>Array.from({length:512},(_,i)=>i===n?1:0);
const base=()=>['center-crop','full-frame'].map((view,i)=>({view,embedding:vector(i)}));
const patches=()=>['top-left','top-right','bottom-left','bottom-right'].map((id,i)=>({id,embedding:vector(i+2)}));

test('fixed center keeps a complete central subject without using a role or code',async()=>{
  assert.deepEqual(centerRect(1800,1350),{left:360,top:270,width:1080,height:810});
  assert.deepEqual(centerRect(1351,1801),{left:270,top:360,width:811,height:1081});
  for(const dims of [[0,100],[64.5,100],[63,100],[20001,64]])assert.throws(()=>centerRect(...dims));
  const bytes=await sharp({create:{width:640,height:480,channels:3,background:'#ffa080'}})
    .withMetadata({orientation:6}).jpeg().toBuffer();
  const saved=Buffer.from(bytes),a=await centerPixels(bytes),b=await centerPixels(await sharp(bytes).rotate().png().toBuffer());
  assert.deepEqual(bytes,saved);assert.deepEqual(a.sourceDimensions,{width:480,height:640});
  assert.deepEqual(a.rect,centerRect(480,640));assert.deepEqual(a.pixels,b.pixels);
  assert.equal(a.pixels.length,3*224*224);assert(a.pixels.every(Number.isFinite));
});

test('all four corners and the complete center have fixed separate positions',()=>{
  const original=base(),local=patches(),center={embedding:vector(6)};
  const result=joinCenterContextViews(original,[...local].reverse(),center);
  for(let v=0;v<2;v++){
    assert.equal(result[v].embedding.length,3072);
    assert.deepEqual(result[v].embedding.map((n,i)=>n?i:-1).filter(i=>i>=0),[v,514,1027,1540,2053,2566]);
    assert(Math.abs(Math.hypot(...result[v].embedding)-1)<1e-6);
  }
  assert.deepEqual(original,base());assert.deepEqual(local,patches());
  result[0].embedding[2566]=0;assert.equal(center.embedding[6],1);
  for(const bad of [null,{embedding:[1]},{embedding:Array(512).fill(NaN)},{embedding:Array(512).fill(0)}])
    assert.throws(()=>joinCenterContextViews(base(),patches(),bad));
  assert.throws(()=>joinCenterContextViews(base(),patches().slice(1),center));
});

test('missing center model cannot return a successful empty observation',async()=>{
  await assert.rejects(()=>createCenterContextEncoder('Z:/not-installed','Z:/not-installed'));
});
