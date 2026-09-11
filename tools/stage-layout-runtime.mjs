import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {runtimeDirectory,readRuntimeFile,verifyRuntimeTree,stageRuntimeTree} from '../src/layout-runtime-assets.mjs';
import {LAYOUT_RUNTIME_MANIFEST_SHA256} from '../src/layout-runtime-lock.mjs';

export function stageLayoutRuntime(sourceBundle,targetAppRoot){
 const source=runtimeDirectory(sourceBundle),root=runtimeDirectory(targetAppRoot);
 if(fs.existsSync(path.join(root,'.git')))throw Error('Stage only into an isolated application snapshot');
 const app=JSON.parse(readRuntimeFile(path.join(root,'package.json'),1_000_000));
 if(app.name!=='prayer-local-runner-v9'||typeof app.version!=='string'||!app.version)throw Error('Unexpected target application');
 const verified=verifyRuntimeTree(source,LAYOUT_RUNTIME_MANIFEST_SHA256);
 const files=verified.files.map(f=>({name:f.name,bytes:readRuntimeFile(path.join(source,...f.name.split('/')),f.sizeBytes)}));
 const parent=path.join(root,'runtime');
 if(fs.existsSync(parent))runtimeDirectory(parent);else fs.mkdirSync(parent);
 const result=stageRuntimeTree({parent,name:'layout-python-v1',files,manifestHash:LAYOUT_RUNTIME_MANIFEST_SHA256});
 return {applicationVersion:app.version,releaseAccepted:false,created:result.created,manifestHash:result.manifestHash,
  fileCount:result.files.length,sizeBytes:result.files.reduce((n,f)=>n+f.sizeBytes,0)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==4)throw Error('Explicit source bundle and isolated app required');
  console.log(JSON.stringify(stageLayoutRuntime(...process.argv.slice(2))));
 }catch{console.error('Layout runtime staging failed; no release authorized.');process.exitCode=1;}
}
