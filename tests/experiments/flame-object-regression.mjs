import test from 'node:test';
import assert from 'node:assert/strict';
import {observeFlameObjects} from './flame-object-reader.mjs';

const frame=(w=240,h=180)=>({data:new Uint8Array(w*h*3).fill(35),w,h});
function rect(f,x,y,w,h,rgb){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)f.data.set(rgb,(yy*f.w+xx)*3);}
function read(f){return observeFlameObjects(f.data,f.w,f.h);}
test('upright bright objects retain geometry and dark bases, not semantic authority',()=>{
  const f=frame();for(const y of [80,115,150])for(const x of [30,70,110,150,190])rect(f,x,y,4,10,[255,244,208]);
  const a=read(f);assert.equal(a.lowerCount,15);assert.ok(a.spanX>.6&&a.spanY>.3);
  assert.equal(a.objects[0].box.width,4);assert.equal(a.sceneRole,null);
  assert.equal(a.foregroundVerified,false);assert.equal(a.mayAuthorizeUpload,false);assert.equal(a.mayClearCodeConflict,false);
});
test('uniform warm sheet, horizontal highlights and dark scene do not become flame objects',()=>{
  const sheet=frame();rect(sheet,20,20,200,150,[250,230,155]);assert.equal(read(sheet).lowerCount,0);
  const bowls=frame();for(const y of [80,115,150])for(const x of [30,70,110,150,190])rect(bowls,x,y,14,3,[255,244,208]);
  assert.equal(read(bowls).lowerCount,0);assert.equal(read(frame()).lowerCount,0);
});
test('bright structure without contrast or dark base is rejected',()=>{
  const f=frame();f.data.fill(190);rect(f,40,80,4,10,[255,244,208]);assert.equal(read(f).lowerCount,0);
  f.data.fill(230);rect(f,40,80,4,10,[255,244,208]);assert.equal(read(f).lowerCount,0);
});
test('bounded RGB inputs and exact size are enforced without mutation',()=>{
  const f=frame(),copy=f.data.slice();read(f);assert.deepEqual(f.data,copy);
  for(const args of [[f.data,240,179,3],[f.data,240,180,1],[f.data,240.1,180,3],[[],240,180,3],[new Uint8Array(1700*16*3),1700,16,3]])assert.throws(()=>observeFlameObjects(...args));
});
