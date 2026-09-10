import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {extractVisiblePdfCodeImages} from './pdf-image-candidates.mjs';

const require=createRequire(import.meta.url);
const {PDFDocument,rgb,degrees,pushGraphicsState,popGraphicsState,rectangle,clip,endPath}=require('pdf-lib');
const {createCanvas}=require('@napi-rs/canvas');
function fragment(text='269-1-123') {
  const canvas=createCanvas(100,15),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,100,15);
  ctx.fillStyle='black';ctx.font='13px Arial';ctx.fillText(text,2,12);
  return canvas.toBuffer('image/png');
}
async function fixture(mode='plain') {
  const doc=await PDFDocument.create(),img=await doc.embedPng(fragment());
  const page=doc.addPage([842,595]);
  const options={x:732,y:570,width:100,height:15};
  if(mode==='clipped')page.pushOperators(pushGraphicsState(),rectangle(732,570,28,15),clip(),endPath());
  page.drawImage(img,{...options,...(mode==='transparent'?{opacity:.3}:{}),...(mode==='rotated'?{rotate:degrees(10)}:{})});
  if(mode==='clipped')page.pushOperators(popGraphicsState());
  if(mode==='hidden')page.drawRectangle({...options,color:rgb(1,1,1)});
  if(mode==='covered')page.drawRectangle({x:758,y:570,width:18,height:15,color:rgb(0,0,0)});
  if(mode==='duplicate')page.drawImage(img,options);
  if(mode==='two-codes')page.drawImage(await doc.embedPng(fragment('269-1-124')),{x:622,y:570,width:100,height:15});
  if(mode==='replaced')page.drawImage(await doc.embedPng(fragment('269-1-124')),options);
  if(mode==='off-page')page.drawImage(img,{x:820,y:520,width:100,height:15});
  if(mode==='second-page')doc.addPage([842,595]).drawImage(img,options);
  return new Uint8Array(await doc.save());
}
test('raw candidate is bound to actual page pixels and immutable PDF identity, not an OCR answer',async()=>{
  const input=await fixture(),before=Buffer.from(input),result=await extractVisiblePdfCodeImages(input);
  assert.deepEqual(Buffer.from(input),before);
  assert.equal(result.pages.length,1);
  const [item]=result.pages[0].candidates;
  assert.equal(result.pages[0].candidates.length,1,JSON.stringify(result.pages[0].rejected));
  assert.equal(item.pageNumber,1);assert.equal(item.width,100);assert.equal(item.height,15);
  assert.deepEqual(item.bounds,{x:732,y:10,width:100,height:15});
  assert.match(item.pdfSha256,/^[a-f0-9]{64}$/);
  assert.equal(item.visiblePixelComparison,'exact');assert.equal(item.rawPixelSha256,item.pagePixelSha256);
  assert.equal(item.mayAuthorizeUpload,false);assert.equal(item.orderBindingVerified,false);
  assert.equal(item.number,undefined);assert.ok(Buffer.isBuffer(item.png));
});
test('hidden, clipped, covered, translucent and rotated images are not usable raw-code evidence',async()=>{
  for(const mode of ['hidden','clipped','covered','transparent','rotated']) {
    const result=await extractVisiblePdfCodeImages(await fixture(mode));
    assert.equal(result.pages[0].candidates.length,0,mode);
    assert.ok(result.pages[0].rejected.length>0,mode);
  }
});
test('identical same-position objects count once, while independent physical pages remain distinct',async()=>{
  const duplicate=await extractVisiblePdfCodeImages(await fixture('duplicate'));
  assert.equal(duplicate.pages[0].candidates.length,1);
  assert.equal(duplicate.pages[0].candidates[0].duplicatePaintCount,2);
  const two=await extractVisiblePdfCodeImages(await fixture('second-page'));
  assert.equal(two.pages.length,2);assert.equal(two.pages[0].candidates.length,1);assert.equal(two.pages[1].candidates.length,1);
  assert.notEqual(two.pages[0].candidates[0].identity,two.pages[1].candidates[0].identity);
});
test('two visible different code images are retained without choosing by position, sequence or expected tail',async()=>{
  const result=await extractVisiblePdfCodeImages(await fixture('two-codes'));
  assert.equal(result.pages[0].candidates.length,2);
  assert.notEqual(result.pages[0].candidates[0].rawPixelSha256,result.pages[0].candidates[1].rawPixelSha256);
});
test('later replacement rejects the hidden old code, and partial off-page paint cannot create a second candidate',async()=>{
  const replaced=await extractVisiblePdfCodeImages(await fixture('replaced'));
  assert.equal(replaced.pages[0].candidates.length,1);
  assert.ok(replaced.pages[0].rejected.some(item=>item.reason==='final-page-pixels-differ'));
  const partial=await extractVisiblePdfCodeImages(await fixture('off-page'));
  assert.equal(partial.pages[0].candidates.length,1);
  assert.ok(partial.pages[0].rejected.some(item=>item.reason==='outside-physical-page'));
});
test('PDF input replacement during an awaited callback fails instead of returning a reusable identity',async()=>{
  const input=await fixture();
  await assert.rejects(()=>extractVisiblePdfCodeImages(input,{onPage:()=>{input[0]^=1;}}),/PDF bytes changed/);
});
