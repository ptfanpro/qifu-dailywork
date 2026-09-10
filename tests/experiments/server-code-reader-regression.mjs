import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {serverCodeImageValues,literalCodeObservations,verifyServerCodeModel} from './server-code-reader.mjs';
const sharp=createRequire(import.meta.url)('sharp');
test('server tensor keeps BGR, aspect ratio and zero padding without changing source',async()=>{
  const png=await sharp({create:{width:100,height:50,channels:3,background:'#ff0000'}}).png().toBuffer();
  const saved=Buffer.from(png),result=await serverCodeImageValues(png),plane=48*320;
  assert.deepEqual(result.dims,[1,3,48,320]);assert.equal(result.resizedWidth,96);
  assert.equal(result.values[0],-1);assert.equal(result.values[plane],-1);assert.equal(result.values[2*plane],1);
  assert.equal(result.values[96],0);assert.equal(result.values[plane+96],0);assert.deepEqual(png,saved);
  const wide=await sharp({create:{width:1000,height:50,channels:3,background:'#fff'}}).png().toBuffer();
  assert.deepEqual((await serverCodeImageValues(wide)).dims,[1,3,48,960]);
});
test('server tensor supports grayscale and alpha; rejects extreme lines rather than crushing glyphs',async()=>{
  const gray=await sharp({create:{width:80,height:40,channels:3,background:'#888'}}).greyscale().png().toBuffer();
  assert.equal((await serverCodeImageValues(gray)).values.length,3*48*320);
  const transparent=await sharp({create:{width:80,height:40,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  assert.equal((await serverCodeImageValues(transparent)).values[0],1);
  const wide=await sharp({create:{width:1000,height:1,channels:3,background:'#fff'}}).png().toBuffer();
  await assert.rejects(serverCodeImageValues(wide),/budget/);
});
test('literal observation keeps prefixes, does not invent digits or join separate lines',()=>{
  assert.deepEqual(literalCodeObservations('编号: 269 - 1 - 32\n268·1·32').codes,['269-1-32','268-1-32']);
  for(const value of ['269-1-I','269-l-32','26O-1-32','269-\n1-32','269-1-\n32','269-1-3 2','269-1-3I','x269-1-32'])
    assert.deepEqual(literalCodeObservations(value).codes,[],value);
  assert.deepEqual(literalCodeObservations('269-1-32\n2026').codes,['269-1-32']);
  assert.equal(literalCodeObservations('269-1-3 2').splitTailObserved,true);
  assert.deepEqual(literalCodeObservations('269-1-32 268-1-33').codes,['269-1-32','268-1-33']);
});
test('missing model is a real failure, not a silent fallback or skip',()=>{
  assert.throws(()=>verifyServerCodeModel('Z:/absent-synthetic-server-model.onnx'));
});
