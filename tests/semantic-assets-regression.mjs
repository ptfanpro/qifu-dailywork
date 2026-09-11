import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {stageVerifiedBundle,stageSemanticAssets} from '../src/semantic-assets.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const asset=(name,text)=>({name,bytes:Buffer.from(text),sha256:hash(Buffer.from(text))});

test('portable assets are copied atomically from verified bytes; identical copies are idempotent',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-assets-test-'));
  try {
    const files=[asset('model.onnx','synthetic encoder'),asset('head.json','synthetic head')];
    const result=stageVerifiedBundle({parent:root,name:'bundle',files});
    assert.equal(result.created,true);assert.equal(result.files.length,2);
    assert.deepEqual(fs.readFileSync(path.join(root,'bundle/model.onnx')),files[0].bytes);
    assert.equal(stageVerifiedBundle({parent:root,name:'bundle',files}).created,false);
    assert.doesNotMatch(JSON.stringify(result),/Users|Temp|synthetic/,'receipt has only names, sizes and hashes');
    assert.deepEqual(fs.readdirSync(root),['bundle']);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('asset staging refuses corruption, duplicates, path escape, and replacement of another bundle',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-assets-test-'));
  try {
    const good=asset('model.onnx','before');
    for(const files of [[{...good,sha256:'0'.repeat(64)}],[good,good],[{...good,name:'../escape'}],
      [{...good,name:'nested/model.onnx'}]]) {
      assert.throws(()=>stageVerifiedBundle({parent:root,name:'bundle',files}));
      assert.deepEqual(fs.readdirSync(root),[],'reject before any destination write');
    }
    assert.throws(()=>stageVerifiedBundle({parent:root,name:'../escape',files:[good]}));
    stageVerifiedBundle({parent:root,name:'bundle',files:[good]});
    assert.throws(()=>stageVerifiedBundle({parent:root,name:'bundle',files:[asset('model.onnx','after')]}));
    assert.deepEqual(fs.readFileSync(path.join(root,'bundle/model.onnx')),good.bytes);
    fs.writeFileSync(path.join(root,'bundle/unexpected'),'keep');
    assert.throws(()=>stageVerifiedBundle({parent:root,name:'bundle',files:[good]}));
    assert.equal(fs.readFileSync(path.join(root,'bundle/unexpected'),'utf8'),'keep');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('production semantic staging never accepts test hashes or an unrelated application',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-assets-test-'));
  try {
    const modelFile=path.join(root,'model.onnx'),headFile=path.join(root,'head.json');
    fs.writeFileSync(modelFile,'wrong');fs.writeFileSync(headFile,'{}');
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'unrelated'}));
    assert.throws(()=>stageSemanticAssets({modelFile,headFile,targetAppRoot:root}));
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'prayer-local-runner-v9',version:'test'}));
    assert.throws(()=>stageSemanticAssets({modelFile,headFile,targetAppRoot:root}));
    assert.equal(fs.existsSync(path.join(root,'models')),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('asset staging rejects linked destinations and case-insensitive duplicate names',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-assets-test-'));
  try{
    const good=asset('model.onnx','before');
    assert.throws(()=>stageVerifiedBundle({parent:root,name:'bundle',files:[good,{...good,name:'MODEL.onnx'}]}));
    const actual=path.join(root,'actual');fs.mkdirSync(actual);
    fs.symlinkSync(actual,path.join(root,'linked'),process.platform==='win32'?'junction':'dir');
    assert.throws(()=>stageVerifiedBundle({parent:root,name:'linked',files:[good]}));
    assert.throws(()=>stageVerifiedBundle({parent:path.join(root,'linked'),name:'nested',files:[good]}));
    assert.deepEqual(fs.readdirSync(actual),[]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
