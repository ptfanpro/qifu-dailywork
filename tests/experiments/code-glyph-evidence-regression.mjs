import test from 'node:test';
import assert from 'node:assert/strict';
import {describePrintedGlyphs,comparePrintedGlyphs} from './code-glyph-evidence.mjs';
const FONT={
  '0':['111','101','101','101','111'], '1':['010','110','010','010','111'],
  '2':['111','001','111','100','111'], '3':['111','001','111','001','111'],
  '6':['111','100','111','101','111'], '8':['111','101','111','101','111'],
  '-':['000','000','111','000','000'],
};
function word(text,scale=3){
  const width=(text.length*5+4)*scale,height=9*scale,data=new Uint8Array(width*height).fill(255);
  for(let i=0;i<text.length;i++)for(let y=0;y<5;y++)for(let x=0;x<3;x++)if(FONT[text[i]][y][x]==='1')
    for(let yy=0;yy<scale;yy++)for(let xx=0;xx<scale;xx++)data[((y+2)*scale+yy)*width+(i*5+x+2)*scale+xx]=0;
  return {data,width,height};
}
const read=w=>describePrintedGlyphs(w.data,w.width,w.height);
test('same complete printed word retains individual glyph evidence across scale',()=>{
  const a=read(word('263-1-86')),b=read(word('263-1-86',5));
  const r=comparePrintedGlyphs(a,[{id:'page-a',glyphs:b}]);
  assert.equal(a.glyphs.length,8);assert.equal(r.rankings[0].minimum,1);
  assert.equal(r.rankings[0].mean,1);assert.equal(r.mayAssignNumber,false);assert.equal(r.mayClearCodeConflict,false);
});
test('one different digit cannot be hidden by the remaining matching code',()=>{
  const a=read(word('263-1-86'));
  const r=comparePrintedGlyphs(a,[{id:'wrong-tail',glyphs:read(word('263-1-88'))},{id:'same',glyphs:a}]);
  assert.equal(r.rankings[0].id,'same');assert.equal(r.rankings[0].minimum,1);
  assert.ok(r.rankings[1].minimum<r.rankings[1].mean);assert.ok(r.rankings[1].minimum<1);
  assert.equal(r.rankings[1].perGlyph.length,8);
});
test('missing glyph is not stretched or filled from a PDF answer',()=>{
  const r=comparePrintedGlyphs(read(word('263-1-8')),[{id:'page-a',glyphs:read(word('263-1-86'))}]);
  assert.equal(r.rankings.length,0);assert.equal(r.rejected[0].reason,'glyph-count-differs');
});
test('identical bitmaps from different pages remain ambiguous',()=>{
  const a=read(word('263-1-86'));
  const r=comparePrintedGlyphs(a,[{id:'first-print',glyphs:a},{id:'second-print',glyphs:a}]);
  assert.equal(r.minimumMargin,0);assert.equal(r.candidate,null);
  assert.equal(r.orderBindingVerified,false);assert.equal(r.mayAuthorizeUpload,false);
});
test('complete prefix differences remain in per-character evidence',()=>{
  const a=read(word('263-1-86'));
  const r=comparePrintedGlyphs(a,[{id:'other-month',glyphs:read(word('268-1-86'))}]);
  assert.equal(r.rankings[0].perGlyph[0],1);assert.ok(r.rankings[0].perGlyph[2]<1);
});
test('blank, malformed and oversized observations fail without changing input',()=>{
  const a=word('263-1-86'),copy=a.data.slice();read(a);assert.deepEqual(a.data,copy);
  assert.equal(read({data:new Uint8Array(600).fill(255),width:100,height:6}).status,'blank');
  assert.throws(()=>describePrintedGlyphs(new Uint8Array(10),20,10));
  assert.throws(()=>describePrintedGlyphs(new Uint8Array(5000*20),5000,20));
  assert.throws(()=>comparePrintedGlyphs(read(a),[{id:'same',glyphs:read(a)},{id:'same',glyphs:read(a)}]));
});
