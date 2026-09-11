// Build-time inputs are explicit. Runtime startup never discovers developer
// Python/NumPy/OpenCV installations and never invokes pip.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {runtimeDirectory,readRuntimeFile,runtimeHash,makeRuntimeManifest,stageRuntimeTree} from '../src/layout-runtime-assets.mjs';
const pins={
 'python.exe':'372c2eae555b344520bf147be0096e009069aeca4e7f78d6aecea6d53158056a',
 'python312.dll':'c1ce6d603041759061139f482c4b90c4ac9db676e30abf52fda66a794aab1bd0',
 'cv2.pyd':'90034927004e4a4ebf29360480d609c8a8d2ca07c93f8b89dff86399e8534b2a',
};
const skipped=new Set(['__pycache__','test','tests','idlelib','tkinter','turtledemo','ensurepip','venv','site-packages']);
export function collectLayoutRuntime(pythonRoot,opencvRoot){
 const python=runtimeDirectory(pythonRoot),opencv=runtimeDirectory(opencvRoot),files=[];
 function add(source,name){const bytes=readRuntimeFile(source);files.push({name,bytes});}
 for(const name of ['python.exe','python3.dll','python312.dll','vcruntime140.dll','vcruntime140_1.dll','LICENSE.txt'])add(path.join(python,name),name);
 function walk(source,dest,predicate){
  runtimeDirectory(source);
  for(const entry of fs.readdirSync(source,{withFileTypes:true})){
   if(entry.isSymbolicLink())throw Error('Linked build input');
   if(entry.isDirectory()){
    if(!skipped.has(entry.name))walk(path.join(source,entry.name),dest+'/'+entry.name,predicate);
   }else if(entry.isFile()&&!/\.py[co]$/i.test(entry.name)&&predicate(entry.name))add(path.join(source,entry.name),dest+'/'+entry.name);
  }
 }
 walk(path.join(python,'Lib'),'Lib',name=>name.endsWith('.py'));
 for(const entry of fs.readdirSync(path.join(python,'DLLs'))){
  if(/\.(pyd|dll)$/i.test(entry)&&!/^(_test|_ctypes_test|_tkinter|tcl|tk)/i.test(entry))add(path.join(python,'DLLs',entry),'DLLs/'+entry);
 }
 const packages=path.join(python,'Lib','site-packages');
 for(const name of ['numpy','numpy.libs'])walk(path.join(packages,name),'site-packages/'+name,()=>true);
 walk(path.join(opencv,'cv2'),'site-packages/cv2',()=>true);
 for(const [base,name] of [[packages,'numpy-2.3.5.dist-info'],[opencv,'opencv_python_headless-4.13.0.92.dist-info']]){
  for(const entry of fs.readdirSync(path.join(base,name))){
   if(entry==='METADATA'||entry==='WHEEL'||/^LICENSE/.test(entry))add(path.join(base,name,entry),'site-packages/'+name+'/'+entry);
  }
 }
 files.push({name:'python312._pth',bytes:Buffer.from('Lib\nDLLs\nsite-packages\n')});
 for(const [name,pin] of Object.entries(pins)){
  const found=files.find(f=>f.name===(name==='cv2.pyd'?'site-packages/cv2/cv2.pyd':name));
  if(!found||runtimeHash(found.bytes)!==pin)throw Error('Unexpected build runtime binary');
 }
 return files;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==5)throw Error('Explicit Python, OpenCV and empty candidate parent required');
  const files=collectLayoutRuntime(process.argv[2],process.argv[3]);
  const manifestHash=runtimeHash(makeRuntimeManifest(files));
  const result=stageRuntimeTree({parent:process.argv[4],name:'layout-python-v1',files,manifestHash});
  console.log(JSON.stringify({candidateOnly:true,releaseAccepted:false,manifestHash,fileCount:result.files.length,
   sizeBytes:result.files.reduce((n,f)=>n+f.sizeBytes,0),created:result.created}));
 }catch{console.error('Local layout runtime candidate build failed; no release authorized.');process.exitCode=1;}
}
