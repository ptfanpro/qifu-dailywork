import assert from 'node:assert/strict';
import {uprightVerticalLine} from './experiments/upright-vertical-line.mjs';

function fixture() {
  const width=24,height=88,data=new Uint8Array(width*height).fill(255);
  // Different upright glyphs, with internal row gaps smaller than inter-glyph gaps.
  for(let n=0;n<3;n++)for(let y=8+n*26;y<26+n*26;y++)for(let x=4;x<20;x++) {
    if(x===4+n*3||y%7<2)data[y*width+x]=0;
  }
  return {data,width,height};
}
const f=fixture(),r=uprightVerticalLine(f.data,f.width,f.height);
assert.equal(r.status,'ready');assert.equal(r.segments.length,3);
assert.equal(r.rotation,0);assert.equal(r.order,'top-to-bottom');
for(const s of r.segments)for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++)
  assert.equal(r.pixels[(s.outputTop+y)*r.width+s.outputLeft+x],f.data[(s.top+y)*f.width+s.left+x],
    'every source glyph pixel must keep its orientation and order');
assert.equal(uprightVerticalLine(new Uint8Array(100).fill(255),10,10).status,'not-vertical');
assert.equal(uprightVerticalLine(new Uint8Array(1000).fill(255),10,100).status,'blank');
assert.equal(uprightVerticalLine(new Uint8Array(1000).fill(0),10,100).status,'foreground-not-isolated');
assert.throws(()=>uprightVerticalLine(new Uint8Array(10),20,30));
assert.throws(()=>uprightVerticalLine(new Uint8Array(100),10,10,{}));
assert.equal(r.mayAssignNumber,false);assert.equal(r.mayClearConflict,false);
console.log('Upright vertical pixel-line regression PASS');
