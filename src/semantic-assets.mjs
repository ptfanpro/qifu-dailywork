// Offline packaging only. Never download assets, discover credentials, or
// overwrite a development/deployed application with a different model bundle.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {loadSemanticHead,SEMANTIC_MODEL_SHA256} from './scene-semantic-reader.mjs';
import {SEMANTIC_HEAD_SHA256} from './scene-semantic-policy.mjs';

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function stat(file){try{return fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function leaf(name){
  if(typeof name!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(name)
    ||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name))
    throw Error('Invalid asset name');
  return name;
}
function directory(input){
  if(typeof input!=='string'||!path.isAbsolute(input))throw Error('Absolute asset directory required');
  const resolved=path.resolve(input),root=path.parse(resolved).root;
  let current=root;
  for(const part of path.relative(root,resolved).split(path.sep).filter(Boolean)){
    current=path.join(current,part);
    const info=stat(current);
    if(!info?.isDirectory()||info.isSymbolicLink())throw Error('Asset directory is missing or linked');
  }
  return resolved;
}
function readRegular(file,limit){
  if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Absolute asset file required');
  directory(path.dirname(file));
  const info=stat(file);
  if(!info?.isFile()||info.isSymbolicLink()||info.size>limit)throw Error('Invalid asset file');
  const bytes=fs.readFileSync(file);
  if(bytes.length>limit)throw Error('Asset size limit exceeded');
  return bytes;
}
function verifyExisting(target,files){
  directory(target);
  const entries=fs.readdirSync(target).sort();
  if(JSON.stringify(entries)!==JSON.stringify(files.map(f=>f.name).sort()))throw Error('Asset bundle contents differ');
  for(const f of files){
    const bytes=readRegular(path.join(target,f.name),f.bytes.length);
    if(bytes.length!==f.bytes.length||hash(bytes)!==f.sha256)throw Error('Asset bundle integrity mismatch');
  }
}

// Generic primitive also used with synthetic bytes in regression tests. The
// production entry point below supplies fixed digests, never CLI hash overrides.
export function stageVerifiedBundle({parent,name,files}){
  const root=directory(parent);leaf(name);
  if(!Array.isArray(files)||files.length<1||files.length>8)throw Error('Invalid asset manifest');
  const seen=new Set();let total=0;
  const verified=files.map(f=>{
    leaf(f?.name);
    if(seen.has(f.name.toLowerCase())||!Buffer.isBuffer(f.bytes)||! /^[a-f0-9]{64}$/.test(f.sha256||''))
      throw Error('Invalid or duplicate asset');
    seen.add(f.name.toLowerCase());total+=f.bytes.length;
    if(total>200_000_000)throw Error('Asset bundle too large');
    const bytes=Buffer.from(f.bytes);
    if(hash(bytes)!==f.sha256)throw Error('Source asset integrity mismatch');
    return {name:f.name,bytes,sha256:f.sha256};
  });
  const receipt=created=>({schemaVersion:1,created,bundle:name,files:verified.map(f=>({name:f.name,sizeBytes:f.bytes.length,sha256:f.sha256}))});
  const target=path.join(root,name);
  if(stat(target)){verifyExisting(target,verified);return receipt(false);}
  const staging=fs.mkdtempSync(path.join(root,`.${name}-staging-`));
  try{
    for(const f of verified)fs.writeFileSync(path.join(staging,f.name),f.bytes,{flag:'wx'});
    verifyExisting(staging,verified);
    if(stat(target))throw Error('Asset destination changed during staging');
    fs.renameSync(staging,target);
    return receipt(true);
  }catch(error){
    // Remove only known files in this call's unique staging directory, never
    // recursively remove a destination or unexpected concurrent contents.
    try{
      directory(staging);
      for(const f of verified){
        const file=path.join(staging,f.name),info=stat(file);
        if(info?.isFile()&&!info.isSymbolicLink()&&info.size===f.bytes.length&&hash(fs.readFileSync(file))===f.sha256)fs.unlinkSync(file);
      }
      if(fs.readdirSync(staging).length===0)fs.rmdirSync(staging);
    }catch{/* Preserve anything whose ownership/integrity cannot be confirmed. */}
    throw error;
  }
}

export function stageSemanticAssets({modelFile,headFile,targetAppRoot}){
  const root=directory(targetAppRoot);
  if(stat(path.join(root,'.git')))throw Error('Stage into an isolated application snapshot, not a source repository');
  const app=JSON.parse(readRegular(path.join(root,'package.json'),1_000_000).toString('utf8'));
  if(app.name!=='prayer-local-runner-v9'||typeof app.version!=='string'||!app.version.trim())throw Error('Unexpected target application');
  const model=readRegular(modelFile,100_000_000),head=readRegular(headFile,2_000_000);
  if(hash(model)!==SEMANTIC_MODEL_SHA256)throw Error('Semantic encoder integrity mismatch');
  loadSemanticHead(head,SEMANTIC_HEAD_SHA256);
  // No destination writes until both complete source assets are verified.
  const parent=path.join(root,'models');
  if(stat(parent))directory(parent);else fs.mkdirSync(parent);
  return {applicationVersion:app.version,releaseAccepted:false,...stageVerifiedBundle({parent,name:'scene-semantic-v1',files:[
    {name:'vision_model_int8.onnx',bytes:model,sha256:SEMANTIC_MODEL_SHA256},
    {name:'role-head.json',bytes:head,sha256:SEMANTIC_HEAD_SHA256},
  ]})};
}
