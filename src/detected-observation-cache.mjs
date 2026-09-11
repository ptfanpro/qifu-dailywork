// Machine-local raw observations only. Every plan re-runs consensus, PDF,
// body, duplicate and upload gates. A saved OCR observation is not an order.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {validDetectedCodeReview} from './detected-code-reader.mjs';
const require=createRequire(import.meta.url),sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const keys=['regions','observations','independent','readings','coverage','errors','incompleteTailObserved',
  'sourceDimensions','engines','review','segmentationReview','rawLineReview','inputSha256','nativeScaleReview'];
const rawOnly=read=>{
  const result={...Object.fromEntries(keys.filter(k=>read?.[k]!==undefined).map(k=>[k,structuredClone(read[k])])),
    confirmed:null,bindingVerified:false};
  if(result.nativeScaleReview?.read)result.nativeScaleReview.read=rawOnly(result.nativeScaleReview.read);
  return result;
};
const sameCrop=(a,b)=>['left','top','width','height'].every(k=>a?.[k]===b?.[k]);
function complete(read,maxRegions){
  if(!read||read.bindingVerified!==false||read.engines!==2||read.errors!==0||read.errorCode||read.error
    ||!validDetectedCodeReview(read)||typeof read.incompleteTailObserved!=='boolean')return false;
  if(read.nativeScaleReview&&!complete(read.nativeScaleReview.read,maxRegions))return false;
  const c=read.coverage,d=read.sourceDimensions;
  if(!d||![d.width,d.height].every(n=>Number.isInteger(n)&&n>0)
    ||!Number.isInteger(read.regions)||read.regions<0||read.regions>=1000
    ||c?.completed!==true||c.kind!=='detected-horizontal-regions'||!Number.isInteger(c.eligibleRegions)
    ||c.eligibleRegions<0||c.eligibleRegions>read.regions||c.eligibleRegions>maxRegions
    ||c.processedRegions!==c.eligibleRegions)return false;
  if(!['observations','independent','readings'].every(k=>Array.isArray(read[k]))
    ||read.readings.length!==c.processedRegions*4)return false;
  const rows=[...read.observations,...read.independent],seen=new Set(),indexes=new Set();
  const validCrop=crop=>crop&&['left','top','width','height'].every(k=>Number.isInteger(crop[k]))
    &&crop.left>=0&&crop.top>=0&&crop.width>0&&crop.height>0
    &&crop.left+crop.width<=d.width&&crop.top+crop.height<=d.height;
  for(const r of read.readings){
    const key=`${r?.engine}:${r?.index}:${r?.padding}`;
    if(!r||!['paddle','tesseract'].includes(r.engine)||![.45,.75].includes(r.padding)
      ||!Number.isInteger(r.index)||r.index<0||r.index>=read.regions||seen.has(key)
      ||r.errorCode!==null||!validCrop(r.crop)||!Number.isFinite(r.confidence)||r.confidence<0
      ||r.confidence>(r.engine==='paddle'?1:100)||!Number.isInteger(r.codeCount)||r.codeCount<0
      ||typeof r.incompleteTailObserved!=='boolean')return false;
    const matching=rows.filter(o=>o.engine===r.engine&&o.index===r.index&&o.padding===r.padding&&o.preprocessing==null);
    if(matching.length!==r.codeCount||matching.some(o=>o.confidence!==r.confidence||!sameCrop(o.crop,r.crop)))return false;
    seen.add(key);indexes.add(r.index);
  }
  if(indexes.size!==c.processedRegions)return false;
  for(const index of indexes)for(const engine of ['paddle','tesseract'])for(const padding of [.45,.75])
    if(!seen.has(`${engine}:${index}:${padding}`))return false;
  for(const [list,engine] of [[read.observations,'paddle'],[read.independent,'tesseract']])for(const o of list){
    const match=/^(\d{3,4})-1-(\d{1,4})$/.exec(o?.fullCode||'');
    if(!match||o.prefix!==match[1]||o.number!==Number(match[2])||o.number<=0||o.engine!==engine
      ||!seen.has(`${engine}:${o.index}:${o.padding}`)||!validCrop(o.crop)
      ||!Number.isFinite(o.confidence)||o.confidence<0||o.confidence>(engine==='paddle'?1:100))return false;
  }
  return true;
}

export async function readDetectedObservation({cacheDir,source,fingerprint,runtimeFingerprint,prefix,maxRegions=100,read}){
  if(!Buffer.isBuffer(source)||!Number.isInteger(maxRegions)||maxRegions<1||maxRegions>300||typeof read!=='function')
    throw Error('Invalid raw observation request');
  const identity={schemaVersion:1,sourceSha256:sha(source),fingerprint,runtimeFingerprint,prefix:String(prefix),maxRegions};
  const enabled=cacheDir&&digest(fingerprint)&&digest(runtimeFingerprint)&&/^\d{3,4}$/.test(String(prefix));
  const file=enabled?path.join(cacheDir,`${sha(JSON.stringify(identity))}.json`):null;
  if(file)try{
    if(fs.statSync(file).size<=16*1024*1024){
      const entry=JSON.parse(fs.readFileSync(file,'utf8'));
      if(JSON.stringify(entry.identity)===JSON.stringify(identity)&&complete(entry.observation,maxRegions)
        &&entry.observationSha256===sha(JSON.stringify(entry.observation)))
        return {observation:rawOnly(entry.observation),cacheHit:true};
    }
  }catch{/* Missing or damaged evidence is a miss, never success. */}
  const observed=await read(source);
  const observation=rawOnly(observed);
  if(file&&complete(observed,maxRegions)){
    let temp=null;
    try{
      fs.mkdirSync(cacheDir,{recursive:true});
      const entry={identity,observation,observationSha256:sha(JSON.stringify(observation))};
      // Preserve a rejected entry before replacing this cache's current pointer.
      if(fs.existsSync(file))fs.copyFileSync(file,`${file}.rejected-${crypto.randomUUID()}`);
      temp=`${file}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(temp,JSON.stringify(entry),{flag:'wx'});fs.renameSync(temp,file);
    }catch{/* Disk/cache failures do not turn a valid fresh OCR into a failure. */}
    finally{if(temp&&fs.existsSync(temp))try{fs.unlinkSync(temp);}catch{}}
  }
  // Do not sanitize a failed live read into a successful one.
  return {observation:complete(observed,maxRegions)?observation:observed,cacheHit:false};
}

// Hash actual loaded code/model bytes once per plan, not just package labels.
// An unsupported/missing runtime disables reuse rather than guessing identity.
export function detectedRuntimeFingerprint(appRoot,workerCacheDir){
  try{
    const entries=[],roots=[];let total=0;
    const file=(name,absolute)=>{
      const stat=fs.lstatSync(absolute);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsupported runtime asset');
      total+=stat.size;if(total>1024*1024*1024||entries.length>=10000)throw Error('Runtime manifest budget');
      entries.push([name,sha(fs.readFileSync(absolute))]);
    };
    const tree=(label,root)=>{
      const walk=(dir,relative='')=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){
        if(e.isSymbolicLink())throw Error('Unbound linked runtime');
        const rel=path.join(relative,e.name),absolute=path.join(dir,e.name);
        if(e.isDirectory()){if(e.name!=='node_modules')walk(absolute,rel);}
        else if(/\.(?:c?js|mjs|json|wasm|node|dll)$/i.test(e.name))file(`${label}/${rel.replaceAll('\\','/')}`,absolute);
      }};walk(root);
    };
    for(const name of ['tesseract.js','tesseract.js-core','sharp']){
      let dir=path.dirname(require.resolve(name));
      while(!fs.existsSync(path.join(dir,'package.json'))||JSON.parse(fs.readFileSync(path.join(dir,'package.json'))).name!==name){
        const parent=path.dirname(dir);if(parent===dir)throw Error('Runtime package not found');dir=parent;
      }
      roots.push([name,dir]);
    }
    if(process.platform!=='win32'||process.arch!=='x64')return null;
    const sharpRoot=roots.find(([label])=>label==='sharp')[1];
    const native=require.resolve('@img/sharp-win32-x64/sharp.node',{paths:[sharpRoot]});
    roots.push(['sharp-native',path.resolve(path.dirname(native),'..')]);
    roots.push(['onnxruntime',path.join(appRoot,'vendor/onnxruntime-node')]);
    for(const [label,root] of roots)tree(label,root);
    for(const name of ['models/paddleocr-zh-v4/ch_PP-OCRv4_det_mobile.onnx','models/paddleocr-en-v5/inference.onnx',
      'models/paddleocr-en-v5/ppocrv5_en_dict.txt','ocr-data/eng.traineddata.gz'])file(name,path.join(appRoot,name));
    file('worker-cache/eng.traineddata',path.join(workerCacheDir,'eng.traineddata'));
    entries.sort((a,b)=>a[0].localeCompare(b[0]));
    return sha(JSON.stringify({node:process.version,arch:process.arch,platform:process.platform,entries}));
  }catch{return null;}
}
