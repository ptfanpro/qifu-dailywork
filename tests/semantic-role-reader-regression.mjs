import assert from 'node:assert/strict';
import {test} from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createSemanticRoleReader,loadSemanticHead,scoreSemanticViews,SEMANTIC_MODEL_SHA256,SEMANTIC_VIEWS} from '../src/scene-semantic-reader.mjs';
import {prepareSemanticPixels,resizeRgbBilinear,SEMANTIC_PIXEL_RECIPE} from '../src/scene-semantic-pixels.mjs';
const sharp=createRequire(import.meta.url)('sharp');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const vector=(n)=>Array.from({length:768},(_,i)=>i===n?1:0);
function model(){return {schemaVersion:1,encoderSha256:SEMANTIC_MODEL_SHA256,
  roles:['paper','lamp','water','mixed-scene'],views:[...SEMANTIC_VIEWS],dimensions:768,minGap:.15,
  heads:SEMANTIC_VIEWS.map(view=>({view,mean:vector(-1),bias:[0,0,0,0],
    weights:Array.from({length:768},(_,i)=>[0,1,2,3].map(k=>i===k?1:0))}))};}
const features=(a,b=a)=>SEMANTIC_VIEWS.map((view,i)=>({view,embedding:vector(i?b:a)}));

test('semantic head requires a pinned complete finite model, not cached labels',()=>{
  const bytes=Buffer.from(JSON.stringify(model()));
  const head=loadSemanticHead(bytes,digest(bytes));
  assert.equal(head.sha256,digest(bytes));
  assert.throws(()=>loadSemanticHead(bytes,'0'.repeat(64)));
  for(const change of [m=>m.minGap=.01,m=>m.views.reverse(),m=>m.roles.reverse(),
    m=>m.dimensions=4,m=>m.heads.pop(),m=>m.heads[0].weights[3][0]=null,
    m=>m.heads[1].mean.pop(),m=>m.encoderSha256='0'.repeat(64)]){
    const bad=model();change(bad);const b=Buffer.from(JSON.stringify(bad));
    assert.throws(()=>loadSemanticHead(b,digest(b)));
  }
});
test('two correlated views retain scores; disagreements and mixed roles abstain',()=>{
  const bytes=Buffer.from(JSON.stringify(model())),head=loadSemanticHead(bytes,digest(bytes));
  for(const [n,role] of [[0,'paper'],[1,'lamp'],[2,'water'],[3,null]]){
    const result=scoreSemanticViews(head,features(n));
    assert.equal(result.candidate,role);assert.equal(result.views.length,2);
    assert.equal(result.mayAuthorizeUpload,false);assert.equal(result.mayClearCodeConflict,false);
    assert.equal(result.independentEngines,1);assert.equal(result.bindingVerified,false);
  }
  assert.equal(scoreSemanticViews(head,features(1,2)).candidate,null);
  const low=features(0);for(const r of low){r.embedding[0]=.51;r.embedding[1]=.49;}
  assert.equal(scoreSemanticViews(head,low).candidate,null);
  assert.throws(()=>scoreSemanticViews(head,features(0).reverse()));
  const bad=features(0);bad[0].embedding[0]=NaN;assert.throws(()=>scoreSemanticViews(head,bad));
  const zero=features(-1);assert.throws(()=>scoreSemanticViews(head,zero));
});
test('invalid local model bytes fail before any inference runtime can load',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-semantic-assets-test-'));
  const headFile=path.join(dir,'head.json'),modelFile=path.join(dir,'model.onnx');
  const bytes=Buffer.from(JSON.stringify(model()));
  try{
    fs.writeFileSync(headFile,bytes);fs.writeFileSync(modelFile,'not an encoder');
    await assert.rejects(createSemanticRoleReader({appRoot:dir,headFile,modelFile,expectedHeadSha256:digest(bytes)}),/encoder integrity/);
    await assert.rejects(createSemanticRoleReader({appRoot:dir,headFile,modelFile,expectedHeadSha256:'0'.repeat(64)}),/head integrity/);
  }finally{for(const f of [headFile,modelFile])if(fs.existsSync(f))fs.unlinkSync(f);fs.rmdirSync(dir);}
});
test('image-only RGB resampling keeps constant colours and rejects invalid geometry',()=>{
  const b=Buffer.alloc(9*7*3);for(let i=0;i<b.length;i+=3){b[i]=17;b[i+1]=100;b[i+2]=254;}
  const out=resizeRgbBilinear(b,9,7,3,4);
  for(let i=0;i<out.length;i+=3)assert.deepEqual([...out.subarray(i,i+3)],[17,100,254]);
  // Independently generated with Pillow BILINEAR, not this implementation.
  assert.deepEqual([...resizeRgbBilinear(Buffer.from(Array.from({length:105},(_,i)=>i)),7,5,3,2)],
    [24,25,26,30,31,32,36,37,38,66,67,68,72,73,74,78,79,80]);
  assert.deepEqual([...resizeRgbBilinear(Buffer.from(Array.from({length:18},(_,i)=>i)),3,2,5,4)],
    [0,1,2,1,2,3,3,4,5,5,6,7,6,7,8,2,3,4,3,4,5,5,6,7,7,8,9,8,9,10,
      7,8,9,8,9,10,10,11,12,12,13,14,13,14,15,9,10,11,10,11,12,12,13,14,14,15,16,15,16,17]);
  assert.throws(()=>resizeRgbBilinear(b,10,7,3,4));
  assert.throws(()=>resizeRgbBilinear(b,9,7,0,4));
});
test('reader preprocessing binds bytes, two explicit views, alpha and EXIF orientation',async()=>{
  const transparent=await sharp({create:{width:9,height:5,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  const read=await prepareSemanticPixels(transparent);
  assert.equal(read.inputSha256,digest(transparent));assert.equal(read.recipe,SEMANTIC_PIXEL_RECIPE);
  assert.deepEqual(read.dimensions,{width:9,height:5});
  assert.equal(read.pixels.length,2*3*224*224);
  assert.ok(read.pixels.every(x=>x===1));
  const mutable=Buffer.from(transparent),before=digest(mutable),pending=prepareSemanticPixels(mutable);
  mutable.fill(0);assert.equal((await pending).inputSha256,before);
  const rotated=await sharp({create:{width:9,height:5,channels:3,background:'#ff0000'}}).jpeg().withMetadata({orientation:6}).toBuffer();
  assert.deepEqual((await prepareSemanticPixels(rotated)).dimensions,{width:5,height:9});
  await assert.rejects(prepareSemanticPixels(Buffer.from('invalid image')));
  await assert.rejects(prepareSemanticPixels('not source bytes'));
});
test('embedded RGB ICC metadata cannot silently change the frozen training pixel recipe',async()=>{
  const tagged=await sharp({create:{width:11,height:7,channels:3,background:'#b43217'}})
    .withIccProfile('p3').png().toBuffer();
  const untagged=await sharp(tagged,{ignoreIcc:true}).png().toBuffer();
  const [a,b]=await Promise.all([prepareSemanticPixels(tagged),prepareSemanticPixels(untagged)]);
  assert.notEqual(a.inputSha256,b.inputSha256);
  assert.equal(digest(Buffer.from(a.pixels.buffer)),digest(Buffer.from(b.pixels.buffer)),
    'Pillow RGB conversion did not apply embedded ICC transforms');
});
