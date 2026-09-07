import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
export function recognitionSourceFingerprint(appRoot) {
  const files=['src/photo-prepare.mjs','src/local-ocr.mjs','src/ocr-image.mjs','src/scene-structure.mjs','src/recognition-provenance.mjs','ui/Read-WindowsOcr.ps1'];
  return hash(JSON.stringify(files.map(file=>[file,hash(fs.readFileSync(path.join(appRoot,file)))])));
}
export function createPdfIndexBinding(businessDate,pdfFiles,recognizerFingerprint) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)||!recognizerFingerprint)throw Error('PDF index identity is incomplete');
  const files=pdfFiles.map(file=>({name:path.basename(file),sha256:hash(fs.readFileSync(file))}));
  files.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:a.sha256.localeCompare(b.sha256));
  return {schemaVersion:1,businessDate,recognizerFingerprint,files,digest:hash(JSON.stringify(files))};
}
export function canReusePdfIndex(plan,binding) {
  const saved=plan?.pdfIndexBinding;
  return Boolean(saved?.schemaVersion===1&&binding?.files?.length
    &&plan.businessDate===binding.businessDate&&saved.businessDate===binding.businessDate
    &&saved.recognizerFingerprint===binding.recognizerFingerprint
    &&saved.digest===binding.digest&&JSON.stringify(saved.files)===JSON.stringify(binding.files));
}

const pathKey=file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
export function createPhotoInputBinding(photoDir,files) {
  const names=new Set();
  const entries=files.map(file=>{
    if(pathKey(path.dirname(file))!==pathKey(photoDir))throw Error('Photo source is outside its business folder');
    const name=path.basename(file),key=process.platform==='win32'?name.toLowerCase():name;
    if(names.has(key))throw Error('Duplicate photo source');
    names.add(key);
    return {name,sha256:hash(fs.readFileSync(file))};
  });
  return {schemaVersion:1,files:entries};
}
export function assertPhotoInputBinding(plan) {
  const binding=plan?.photoInputBinding;
  if(binding?.schemaVersion!==1||!Array.isArray(binding.files))throw Error('照片计划缺少原图内容凭据，请重新检测；未修改照片。');
  const sources=new Set(),targets=new Set();
  for(const assignment of plan.assignments||[]) {
    if(!/^(?:\d+|2\.[1256])\.jpg$/i.test(assignment.targetName||'')||targets.has(assignment.targetName.toLowerCase()))throw Error('照片目标编号不唯一或路径无效，未修改照片。');
    targets.add(assignment.targetName.toLowerCase());
  }
  for(const item of [...(plan.assignments||[]),...(plan.duplicateSources||[])]) {
    const key=pathKey(item.source);
    if(pathKey(path.dirname(item.source))!==pathKey(plan.photoDir)||sources.has(key))throw Error('照片来源不唯一或越出业务目录，未修改照片。');
    sources.add(key);
    const match=binding.files.filter(entry=>pathKey(path.join(plan.photoDir,entry.name))===key);
    if(match.length!==1||match[0].sha256!==hash(fs.readFileSync(item.source)))throw Error('照片内容在识别后发生变化，请重新检测；未修改照片。');
  }
}
