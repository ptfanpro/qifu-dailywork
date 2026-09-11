import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {makeRuntimeManifest,stageRuntimeTree,verifyRuntimeTree} from '../src/layout-runtime-assets.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fixtures=()=>[{name:'python.exe',bytes:Buffer.from('synthetic executable')},
 {name:'Lib/encodings/__init__.py',bytes:Buffer.from('synthetic codec')},
 {name:'python312._pth',bytes:Buffer.from('Lib\nDLLs\nsite-packages\n')}];
test('runtime tree stages exact pinned bytes, relocates, and refuses different existing content',()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-runtime-assets-'));
 try{
  const files=fixtures(),manifestHash=hash(makeRuntimeManifest(files));
  const options={parent,name:'layout-python-v1',files,manifestHash};
  assert.equal(stageRuntimeTree(options).created,true);
  assert.equal(stageRuntimeTree(options).created,false);
  const target=path.join(parent,options.name),moved=path.join(parent,'relocated with spaces');
  fs.cpSync(target,moved,{recursive:true});
  assert.equal(verifyRuntimeTree(moved,manifestHash).files.length,3);
  fs.appendFileSync(path.join(target,'python.exe'),'changed');
  assert.throws(()=>stageRuntimeTree(options),/integrity|size/i);
  assert.equal(fs.readFileSync(path.join(target,'python.exe'),'utf8'),'synthetic executablechanged');
 }finally{fs.rmSync(parent,{recursive:true,force:true});}
});
test('runtime verification rejects altered manifests, extra files, omissions and links',()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-runtime-reject-'));
 try{
  const files=fixtures(),manifestHash=hash(makeRuntimeManifest(files));
  for(const [i,mutate] of [
   root=>fs.appendFileSync(path.join(root,'manifest.json'),' '),
   root=>fs.writeFileSync(path.join(root,'sitecustomize.py'),'unexpected'),
   root=>fs.unlinkSync(path.join(root,'python.exe')),
   root=>{fs.unlinkSync(path.join(root,'Lib/encodings/__init__.py'));fs.symlinkSync(parent,path.join(root,'Lib/encodings/escape'),'junction');},
  ].entries()){
   const name=`runtime-${i}`;stageRuntimeTree({parent,name,files,manifestHash});
   const root=path.join(parent,name);mutate(root);assert.throws(()=>verifyRuntimeTree(root,manifestHash));
  }
 }finally{fs.rmSync(parent,{recursive:true,force:true});}
});
test('runtime staging validates names, paths and source manifest before creating output',()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-runtime-source-'));
 try{
  const good=fixtures(),manifestHash=hash(makeRuntimeManifest(good));
  for(const name of ['../escape','C:/escape','a\\b','a/../b','a//b','CON','a./file','a:stream','a ']){
   assert.throws(()=>makeRuntimeManifest([{name,bytes:Buffer.from('x')}]));
  }
  for(const files of [[...good,{name:'PYTHON.EXE',bytes:Buffer.from('x')}],
   [...good,{name:'Lib',bytes:Buffer.from('x')}],good.map((x,i)=>i?x:{...x,bytes:Buffer.from('changed')})]){
   assert.throws(()=>stageRuntimeTree({parent,name:'runtime',files,manifestHash}));
   assert.equal(fs.existsSync(path.join(parent,'runtime')),false);
  }
  assert.throws(()=>stageRuntimeTree({parent,name:'../escape',files:good,manifestHash}));
  assert.throws(()=>stageRuntimeTree({parent,name:'runtime',files:good,manifestHash:'0'.repeat(64)}));
  assert.equal(fs.readdirSync(parent).length,0);
 }finally{fs.rmSync(parent,{recursive:true,force:true});}
});
