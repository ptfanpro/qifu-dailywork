// Offline runtime asset integrity. No downloads, installation or host settings.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const runtimeHash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const MAX_FILES=5000, MAX_TOTAL=300_000_000, MAX_FILE=200_000_000;
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function info(file){try{return fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export function runtimeDirectory(input){
  if(typeof input!=='string'||!path.isAbsolute(input))throw Error('Absolute runtime directory required');
  const resolved=path.resolve(input),root=path.parse(resolved).root;
  let current=root;
  for(const part of path.relative(root,resolved).split(path.sep).filter(Boolean)){
    current=path.join(current,part);const s=info(current);
    if(!s?.isDirectory()||s.isSymbolicLink())throw Error('Runtime directory missing or linked');
  }
  return resolved;
}
function validName(name){
  if(typeof name!=='string'||name.length>220||name.toLowerCase()==='manifest.json'
    ||!name.split('/').every(part=>/^[a-zA-Z0-9_][a-zA-Z0-9._+-]*$/.test(part)
      &&!/[. ]$/.test(part)&&!/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)))
    throw Error('Invalid runtime asset name');
  return name;
}
function validateRecords(records){
  if(!Array.isArray(records)||!records.length||records.length>MAX_FILES)throw Error('Invalid runtime manifest');
  const seen=new Set();let total=0;
  for(const f of records){
    validName(f?.name);
    const key=f.name.toLowerCase();
    if(seen.has(key)||!sha(f.sha256)||!Number.isSafeInteger(f.sizeBytes)||f.sizeBytes<0||f.sizeBytes>MAX_FILE)
      throw Error('Invalid or duplicate runtime record');
    seen.add(key);total+=f.sizeBytes;
  }
  if(total>MAX_TOTAL)throw Error('Runtime asset budget exceeded');
  for(const key of seen){
    const parts=key.split('/');parts.pop();
    while(parts.length){if(seen.has(parts.join('/')))throw Error('Runtime file/directory collision');parts.pop();}
  }
  return records;
}
export function readRuntimeFile(file,limit=MAX_FILE){
  runtimeDirectory(path.dirname(file));const s=info(file);
  if(!s?.isFile()||s.isSymbolicLink()||s.size>limit)throw Error('Invalid runtime asset file or size');
  const bytes=fs.readFileSync(file);
  if(bytes.length>limit)throw Error('Runtime asset size changed');
  return bytes;
}
export function makeRuntimeManifest(files){
  if(!Array.isArray(files)||files.some(f=>!Buffer.isBuffer(f?.bytes)))throw Error('Runtime bytes required');
  const records=validateRecords(files.map(f=>({name:f.name,sizeBytes:f.bytes.length,sha256:runtimeHash(f.bytes)})))
    .sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  return Buffer.from(JSON.stringify({schemaVersion:1,files:records}));
}
function listedFiles(root){
  const result=[];let entries=0;
  function visit(dir,prefix=''){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      if(++entries>MAX_FILES*2||prefix.split('/').length>32)throw Error('Runtime tree budget exceeded');
      const name=prefix+entry.name,full=path.join(dir,entry.name);
      if(entry.isSymbolicLink())throw Error('Linked runtime asset');
      if(entry.isDirectory())visit(full,name+'/');
      else if(entry.isFile())result.push(name);
      else throw Error('Unexpected runtime filesystem entry');
      if(result.length>MAX_FILES+1)throw Error('Too many runtime files');
    }
  }
  visit(root);return result.sort();
}
export function verifyRuntimeTree(input,manifestHash){
  const root=runtimeDirectory(input);
  if(!sha(manifestHash))throw Error('Trusted runtime manifest hash required');
  const bytes=readRuntimeFile(path.join(root,'manifest.json'),2_000_000);
  if(runtimeHash(bytes)!==manifestHash)throw Error('Runtime manifest integrity mismatch');
  const manifest=JSON.parse(bytes.toString('utf8'));
  if(manifest.schemaVersion!==1)throw Error('Unknown runtime manifest');
  const files=validateRecords(manifest.files);
  if(JSON.stringify(listedFiles(root))!==JSON.stringify([...files.map(f=>f.name),'manifest.json'].sort()))
    throw Error('Runtime bundle contents differ');
  for(const f of files){
    const data=readRuntimeFile(path.join(root,...f.name.split('/')),f.sizeBytes);
    if(data.length!==f.sizeBytes||runtimeHash(data)!==f.sha256)throw Error('Runtime asset integrity mismatch');
  }
  return {schemaVersion:1,manifestHash,files};
}
export function stageRuntimeTree({parent,name,files,manifestHash}){
  const root=runtimeDirectory(parent);validName(name);
  if(name.includes('/'))throw Error('Single runtime bundle name required');
  const manifest=makeRuntimeManifest(files);
  if(!sha(manifestHash)||runtimeHash(manifest)!==manifestHash)throw Error('Source runtime manifest integrity mismatch');
  const target=path.join(root,name);
  if(info(target))return {...verifyRuntimeTree(target,manifestHash),created:false};
  const staging=fs.mkdtempSync(path.join(root,`.${name}-staging-`));
  // On failure leave this unique staging folder for inspection. Never delete
  // arbitrary concurrent contents or overwrite a deployed/previous bundle.
  for(const f of files){
    const destination=path.join(staging,...f.name.split('/'));
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.writeFileSync(destination,f.bytes,{flag:'wx'});
  }
  fs.writeFileSync(path.join(staging,'manifest.json'),manifest,{flag:'wx'});
  verifyRuntimeTree(staging,manifestHash);
  if(info(target))throw Error('Runtime target changed during staging');
  fs.renameSync(staging,target);
  return {...verifyRuntimeTree(target,manifestHash),created:true};
}
