// Lazy, offline, app-local worker. Geometry alone is never page/order proof.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {runtimeDirectory,readRuntimeFile,runtimeHash,verifyRuntimeTree} from './layout-runtime-assets.mjs';
import {LAYOUT_RUNTIME_MANIFEST_SHA256,LAYOUT_WORKER_SHA256,LAYOUT_GEOMETRY_SHA256} from './layout-runtime-lock.mjs';
const accepted=new WeakMap();
const forbiddenFlags=['paperVerified','foregroundVerified','physicalCodeExtentVerified','bindingVerified',
 'mayClearCodeConflict','mayAssignNumber','mayUploadScene'];
const dimensions=s=>Array.isArray(s)&&s.length===2&&s.every(n=>Number.isInteger(n)&&n>=32&&n<=1800);
const id=value=>typeof value==='string'&&/^[a-f0-9]{64}(?::[1-9][0-9]{0,4})?$/.test(value);

export function validLayoutResponse(result,request,requestSha256){
 try{
  if(!/^[a-f0-9]{64}$/.test(requestSha256||'')||result?.schemaVersion!==1||result.complete!==true||result.operation!==request.operation
   ||result.requestSha256!==requestSha256||result.mayAssignNumber!==false)return false;
  const r=result.runtime;
  if(r?.python!=='3.12.14'||r.numpy!=='2.3.5'||r.opencv!=='4.13.0'
   ||r.isolated!==true||r.noSite!==true||r.localImports!==true||r.localSearchPaths!==true)return false;
  if(request.operation==='smoke')return result.geometryComputed===true;
  if(request.operation!=='match'||result.mayClearCodeConflict!==false||result.coordinateFrame!=='printed-ink'
   ||!Array.isArray(result.results)||result.results.length!==request.photos.length)return false;
  return result.results.every((photo,i)=>photo.id===request.photos[i].id&&photo.imageSha256===request.photos[i].sha256
   &&dimensions(photo.shape)&&Array.isArray(photo.pages)&&photo.pages.length===request.pages.length
   &&photo.pages.every((page,j)=>page.id===request.pages[j].id&&page.imageSha256===request.pages[j].sha256
    &&dimensions(page.shape)&&typeof page.evidence?.candidate==='boolean'
    &&page.evidence.coordinateFrame==='printed-ink'&&forbiddenFlags.every(flag=>page.evidence[flag]===false)));
 }catch{return false;}
}
export function isFreshLayoutObservation(result){
 const seal=result&&accepted.get(result);
 try{return Boolean(seal&&seal===runtimeHash(JSON.stringify(result)));}catch{return false;}
}
function checkedRuntime(appRoot){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('Layout runtime requires Windows x64');
 const app=runtimeDirectory(appRoot),root=runtimeDirectory(path.join(app,'runtime','layout-python-v1'));
 verifyRuntimeTree(root,LAYOUT_RUNTIME_MANIFEST_SHA256);
 for(const [name,digest] of [['layout_runtime_worker.py',LAYOUT_WORKER_SHA256],['printed_layout_geometry.py',LAYOUT_GEOMETRY_SHA256]]){
  if(runtimeHash(readRuntimeFile(path.join(app,'src',name),1_000_000))!==digest)throw Error('Layout worker source integrity mismatch');
 }
 return {root,worker:path.join(app,'src','layout_runtime_worker.py')};
}
function execute(runtime,request,timeoutMs){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300_000)throw Error('Invalid layout timeout');
 const input=JSON.stringify(request),requestSha256=runtimeHash(input);
 // Never pass credentials, PYTHONPATH, user site or arbitrary PATH entries.
 const systemRoot=process.env.SystemRoot||process.env.SYSTEMROOT;
 if(!systemRoot||!path.isAbsolute(systemRoot))throw Error('Missing Windows system root');
 const env={SystemRoot:systemRoot,WINDIR:systemRoot,PATH:path.join(systemRoot,'System32'),
  TEMP:os.tmpdir(),TMP:os.tmpdir(),OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1'};
 return new Promise((resolve,reject)=>{
  const child=execFile(path.join(runtime.root,'python.exe'),['-I','-B','-S',runtime.worker],
   {cwd:runtime.root,env,windowsHide:true,timeout:timeoutMs,maxBuffer:32*1024*1024,encoding:'utf8'},(error,stdout)=>{
    if(error){reject(Error(error.killed?'Layout worker timed out':'Layout worker failed'));return;}
    try{
     const result=JSON.parse(stdout);
     if(!validLayoutResponse(result,request,requestSha256))throw Error('Invalid result');
     // Files can change during a long computation. Recheck the complete pinned
     // runtime and worker before retaining an observation for the caller.
     verifyRuntimeTree(runtime.root,LAYOUT_RUNTIME_MANIFEST_SHA256);
     for(const [name,digest] of [['layout_runtime_worker.py',LAYOUT_WORKER_SHA256],['printed_layout_geometry.py',LAYOUT_GEOMETRY_SHA256]])
      if(runtimeHash(readRuntimeFile(path.join(path.dirname(runtime.worker),name),1_000_000))!==digest)throw Error('Changed worker');
     result.runtimeManifestSha256=LAYOUT_RUNTIME_MANIFEST_SHA256;
     result.geometrySourceSha256=LAYOUT_GEOMETRY_SHA256;
     accepted.set(result,runtimeHash(JSON.stringify(result)));resolve(result);
    }catch{reject(Error('Layout result or runtime integrity verification failed'));}
   });
  child.stdin.on('error',()=>{}); // Early worker exit is reported by execFile.
  child.stdin.end(input);
 });
}
export async function smokeLayoutRuntime(appRoot,{timeoutMs=30_000}={}){
 return execute(checkedRuntime(appRoot),{schemaVersion:1,operation:'smoke'},timeoutMs);
}
export async function matchPrintedLayouts(appRoot,{pages,photos,timeoutMs=180_000}){
 if(!Array.isArray(pages)||!pages.length||pages.length>32||!Array.isArray(photos)||!photos.length||photos.length>8)
  throw Error('Layout request budget exceeded');
 const seen=new Set();let total=0;
 const images=[...pages,...photos].map(item=>{
  if(!id(item?.id)||seen.has(item.id)||!Buffer.isBuffer(item.bytes)||item.bytes.length>20_000_000
   ||!item.bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid layout image input');
  seen.add(item.id);total+=item.bytes.length;
  if(total>150_000_000)throw Error('Layout image budget exceeded');
  return {id:item.id,bytes:Buffer.from(item.bytes)};
 });
 const runtime=checkedRuntime(appRoot),root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-layout-job-'));
 const records=[];
 try{
  for(const [i,image] of images.entries()){
   const file=`image-${i}.png`,sha256=runtimeHash(image.bytes);
   fs.writeFileSync(path.join(root,file),image.bytes,{flag:'wx'});records.push({id:image.id,file,sha256});
  }
  return await execute(runtime,{schemaVersion:1,operation:'match',inputRoot:root,
   pages:records.slice(0,pages.length),photos:records.slice(pages.length)},timeoutMs);
 }finally{
  // Only this call's unchanged copies can be removed. Preserve anything else.
  for(const r of records){try{
   const file=path.join(root,r.file),s=fs.lstatSync(file);
   if(s.isFile()&&!s.isSymbolicLink()&&runtimeHash(fs.readFileSync(file))===r.sha256)fs.unlinkSync(file);
  }catch{}}
  try{fs.rmdirSync(root);}catch{}
 }
}
