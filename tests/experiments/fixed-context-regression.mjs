import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {contextRects,contextPixels,joinContextViews,createFixedContextEncoder} from './fixed-context-reader.mjs';
const sharp=createRequire(import.meta.url)('sharp');
const ids=['top-left','top-right','bottom-left','bottom-right'];
const vector=n=>Array.from({length:512},(_,i)=>i===n?1:0);
const base=()=>['center-crop','full-frame'].map((view,i)=>({view,embedding:vector(i)}));
const patches=()=>ids.map((id,i)=>({id,embedding:vector(i+2)}));

test('fixed overlapping quarters cover every oriented pixel, never use a predicted role',()=>{
  for(const [width,height] of [[1800,1350],[1351,1801],[65,64]]) {
    const rects=contextRects(width,height);assert.deepEqual(rects.map(r=>r.id),ids);
    for(let y=0;y<height;y+=Math.max(1,Math.floor(height/19)))for(let x=0;x<width;x+=Math.max(1,Math.floor(width/19)))
      assert(rects.some(r=>x>=r.left&&x<r.left+r.width&&y>=r.top&&y<r.top+r.height));
    assert.equal(rects[3].left+rects[3].width,width);assert.equal(rects[3].top+rects[3].height,height);
    assert(rects[0].left+rects[0].width>rects[1].left);
  }
  for(const dims of [[0,20],[64.5,128],[Infinity,65],[63,64]])assert.throws(()=>contextRects(...dims));
});

test('actual local preprocessing preserves source bytes, orientation and all four fixed views',async()=>{
  const data=Buffer.alloc(480*320*3);for(let y=0;y<320;y++)for(let x=0;x<480;x++) {
    const offset=(y*480+x)*3;data[offset]=x%251;data[offset+1]=y%251;data[offset+2]=(x+y)%251;
  }
  const jpeg=await sharp(data,{raw:{width:480,height:320,channels:3}}).withMetadata({orientation:6}).jpeg().toBuffer();
  const before=Buffer.from(jpeg),oriented=await sharp(jpeg).rotate().png().toBuffer();
  const a=await contextPixels(jpeg),b=await contextPixels(oriented);
  assert.deepEqual(jpeg,before);assert.deepEqual(a.sourceDimensions,{width:320,height:480});
  assert.deepEqual(a.regions.map(r=>r.rect),contextRects(320,480));
  assert.deepEqual(a.regions.map(r=>r.pixels),b.regions.map(r=>r.pixels));
  assert.equal(new Set(a.regions.map(r=>r.inputSha256)).size,4);
  for(const r of a.regions){assert.equal(r.pixels.length,3*224*224);assert([...r.pixels].every(Number.isFinite));}
});

test('context joins every position in fixed order, not a best tile or independent vote',()=>{
  const original=base(),local=patches(),merged=joinContextViews(original,[...local].reverse());
  assert.equal(merged.length,2);assert.deepEqual(merged.map(v=>v.view),original.map(v=>v.view));
  for(let v=0;v<2;v++) {
    assert.equal(merged[v].embedding.length,2560);
    const positions=merged[v].embedding.map((n,i)=>n?i:-1).filter(i=>i>=0);
    assert.deepEqual(positions,[v,514,1027,1540,2053]);
    assert(Math.abs(Math.hypot(...merged[v].embedding)-1)<1e-6);
  }
  assert.deepEqual(original,base());assert.deepEqual(local,patches());
  merged[0].embedding[0]=0;assert.equal(original[0].embedding[0],1);
});

test('missing, duplicate, wrong-dimensional and nonfinite tiles cannot be a reusable descriptor',()=>{
  for(const bad of [patches().slice(0,3),[patches()[0],patches()[0],...patches().slice(2)],
    patches().map((r,i)=>i? r:{...r,embedding:[1]}),
    patches().map((r,i)=>i? r:{...r,embedding:Array(512).fill(NaN)}),
    patches().map((r,i)=>i? r:{...r,embedding:Array(512).fill(0)})])assert.throws(()=>joinContextViews(base(),bad));
  assert.throws(()=>joinContextViews([base()[0],base()[0]],patches()));
});

test('absent fixed model fails rather than producing an empty successful feature set',async()=>{
  await assert.rejects(()=>createFixedContextEncoder('Z:/not-installed','Z:/not-installed'));
});
