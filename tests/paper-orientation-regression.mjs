import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {inspectPaperGeometry,paperCodeLayoutsFromGeometry,paperPortraitFromGeometry,reconcileDuplicatePhotoNumbersByPdfStructure} from '../src/photo-prepare.mjs';

const geometry=(imageWidth,imageHeight,paperWidth=300,paperHeight=350)=>({
  left:50/imageWidth,top:50/imageHeight,width:paperWidth/imageWidth,height:paperHeight/imageHeight,
  right:(50+paperWidth)/imageWidth,bottom:(50+paperHeight)/imageHeight,
  imageWidth,imageHeight,usablePaper:true,rectangularPaper:true,
});
test('physical paper orientation is independent of the surrounding canvas',()=>{
  for(const [w,h] of [[1600,800],[800,1600],[800,800]]) {
    assert.equal(paperPortraitFromGeometry(geometry(w,h)),false);
    assert.equal(paperPortraitFromGeometry(geometry(w,h,220,450)),true);
  }
});
test('paper-relative code windows preserve physical coordinates across canvases',()=>{
  const crops=[];
  for(const [w,h] of [[1600,800],[800,1600],[800,800]]) {
    crops.push(paperCodeLayoutsFromGeometry(geometry(w,h)).map(r=>({name:r.name,
      left:Math.round(r.left*w),top:Math.round(r.top*h),width:Math.round(r.width*w),height:Math.round(r.height*h)})));
  }
  assert.deepEqual(crops[0],crops[1]);assert.deepEqual(crops[1],crops[2]);
});
test('missing or invalid physical dimensions do not assert a paper orientation',()=>{
  const g=geometry(800,800);
  for(const imageWidth of [undefined,null,0,-1,NaN,Infinity,2.5]) {
    assert.equal(paperPortraitFromGeometry({...g,imageWidth}),null);
    assert.deepEqual(paperCodeLayoutsFromGeometry({...g,imageWidth}),[]);
  }
  for(const update of [{width:0},{height:-.2},{left:NaN},{top:.99},{width:1.1}]) {
    assert.equal(paperPortraitFromGeometry({...g,...update}),null);
  }
});
test('canvas distortion cannot make a duplicate landscape claim switch to a missing portrait page',async()=>{
  const items=[geometry(1200,800,600,400),geometry(2000,1000,600,400)].map((paperGeometry,i)=>({
    file:`synthetic-${i}.jpg`,number:23,reliable:true,paperGeometry,visualMetrics:{},sceneMetrics:{},
    evidence:{method:'synthetic-weak-candidate'},candidates:[],
  }));
  const pdfs=[{number:23,portrait:false,pdfName:'synthetic红纸1.pdf'},{number:28,portrait:true,pdfName:'synthetic红纸2.pdf'}];
  const changes=await reconcileDuplicatePhotoNumbersByPdfStructure(items,pdfs,new Set([23,28]),new Set(),{getPaperColor:async()=>'red'});
  assert.deepEqual(changes,[]);
  assert.deepEqual(items.map(r=>r.number),[23,23]);
});
test('actual pixel geometry records EXIF-oriented source dimensions, not resized mask dimensions',async()=>{
  const sharp=createRequire(import.meta.url)('sharp');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-paper-orientation-'));
  try {
    const panel=await sharp({create:{width:400,height:300,channels:3,background:{r:220,g:35,b:75}}}).png().toBuffer();
    for(const orientation of [1,6,8]) {
      const encoded=await sharp({create:{width:600,height:900,channels:3,background:'#888888'}})
        .composite([{input:panel,left:100,top:250}]).withMetadata({orientation}).jpeg({quality:95}).toBuffer();
      const file=path.join(directory,`synthetic-${orientation}.jpg`);
      fs.writeFileSync(file,encoded);
      const g=await inspectPaperGeometry(file);
      assert.deepEqual([g.imageWidth,g.imageHeight],orientation===1?[600,900]:[900,600]);
      assert.equal(paperPortraitFromGeometry(g),orientation!==1);
      assert.deepEqual(fs.readFileSync(file),encoded,'inspection must not rewrite input');
    }
  } finally {
    const base=fs.realpathSync(os.tmpdir()),target=fs.realpathSync(directory),rel=path.relative(base,target);
    assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)&&path.basename(target).startsWith('qifu-paper-orientation-'));
    fs.rmSync(target,{recursive:true,force:true});
  }
});
