import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {siglip2Input,siglip2Embeddings,verifySiglip2Model} from './siglip2-vision.mjs';

test('explicit two-view bounded CHW little-endian contract',()=>{
  const bytes=Buffer.alloc(2*3*224*224*4);bytes.writeFloatLE(.5,0);
  assert.equal(siglip2Input(bytes)[0],.5);
  assert.throws(()=>siglip2Input(bytes.subarray(4)));
  bytes.writeFloatLE(NaN,0);assert.throws(()=>siglip2Input(bytes));
  bytes.writeFloatLE(1.1,0);assert.throws(()=>siglip2Input(bytes));
});
test('pooled output dimensions and finite normalized features',()=>{
  const data=new Float32Array(1536);data[0]=3;data[768]=4;
  const rows=siglip2Embeddings({dims:[2,768],data});
  assert.equal(rows[0].embedding[0],1);assert.equal(rows[1].embedding[0],1);
  assert.throws(()=>siglip2Embeddings({dims:[2,512],data}));
  assert.throws(()=>siglip2Embeddings({dims:[2,768],data:new Float32Array(1536)}));
  data[0]=Infinity;assert.throws(()=>siglip2Embeddings({dims:[2,768],data}));
});
test('model bytes must match the pinned publisher artifact',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-siglip-pin-test-'));
  const file=path.join(dir,'invalid.onnx');fs.writeFileSync(file,'not-a-model');
  try{assert.throws(()=>verifySiglip2Model(file),/integrity mismatch/);}
  finally{fs.unlinkSync(file);fs.rmdirSync(dir);}
});
