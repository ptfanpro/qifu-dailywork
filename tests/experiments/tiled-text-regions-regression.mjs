import assert from 'node:assert/strict';
import {textTiles,projectTextRegion,detectTiledText} from './tiled-text-regions.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),sharp=require('sharp');
for(const [w,h] of [[1800,1350],[17,9],[640,480],[641,481],[1350,1800]]) {
  const tiles=textTiles(w,h);
  const covered=new Uint8Array(w*h);
  for(const t of tiles) {
    assert.ok(t.left>=0&&t.top>=0&&t.left+t.width<=w&&t.top+t.height<=h);
    for(let y=t.top;y<t.top+t.height;y++)covered.fill(1,y*w+t.left,y*w+t.left+t.width);
  }
  assert.ok(covered.every(Boolean),'every original pixel remains covered');
  assert.equal(new Set(tiles.map(t=>JSON.stringify(t))).size,tiles.length);
}
assert.throws(()=>textTiles(1800,1350,{maxTiles:1}),/limit/);
assert.throws(()=>textTiles(10,10,{overlapX:640}),/Overlap/);
assert.throws(()=>textTiles(NaN,10),/width/);
const r=projectTextRegion({left:.25,top:.5,width:.5,height:.25,score:.9},
  {left:100,top:200,width:400,height:200},{width:1000,height:500});
assert.deepEqual(r,{left:.2,top:.6,width:.2,height:.1,score:.9});
assert.throws(()=>projectTextRegion({left:.9,top:0,width:.2,height:.1},{},{ }),/outside/);
const bytes=await sharp({create:{width:96,height:72,channels:3,background:'#ddbb66'}}).png().toBuffer();
let calls=0;
const detector={async detect(b){calls++;const m=await sharp(b).metadata();assert.equal(m.width,128);
  return {regions:[{left:.25,top:.25,width:.5,height:.5,score:.8}]};}};
const result=await detectTiledText(detector,bytes,{tileWidth:64,tileHeight:48,overlapX:16,overlapY:12,normalize:true});
assert.equal(calls,4);assert.equal(result.regions.length,4);assert.equal(result.original.info.width,96);
assert.deepEqual(result.regions.map(r=>r.tileIndex),[0,1,2,3]);
await assert.rejects(detectTiledText({async detect(){throw Error('model error');}},bytes),/model error/);
console.log('Experimental tiled text geometry and failure retention PASS');
