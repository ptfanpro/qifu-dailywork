// Integrity of offline audit evidence; checksums are not signatures or proof
// that an OCR assignment is correct. No business operations are authorized here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const fileSha=file=>sha(fs.readFileSync(file));
const validSha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export function assertAuditOriginalsUnchanged(day) {
  if(!Array.isArray(day?.photos)||!Array.isArray(day?.pdfs))throw Error('Invalid audit inventory');
  for(const item of [...day.photos,...day.pdfs]) {
    let unchanged=false;
    try {unchanged=validSha(item.sha256)&&fileSha(item.file)===item.sha256;}catch{}
    if(!unchanged)throw Error('Source changed since inventory; audit stopped before reuse or processing');
  }
}

function inputDigest(day) {
  return sha(JSON.stringify({date:day.date,folder:day.folder,photoDir:day.photoDir,
    photos:day.photos.map(p=>({file:p.file,sha256:p.sha256,referenceLabel:p.referenceLabel,referenceNumber:p.referenceNumber})),
    pdfs:day.pdfs.map(p=>({file:p.file,sha256:p.sha256}))}));
}
function auditProgramDigest(appRoot) {
  return sha(JSON.stringify(['tests/annual-replay.mjs','tests/audit-replay-cache.mjs','tests/audit-paths.mjs']
    .map(name=>[name,fileSha(path.join(appRoot,name))])));
}
function artifactsFor(action) {
  if(action==='structure')return [];
  if(action==='replay')return ['private-plan.json','private-source-map.json'];
  throw Error('Invalid audit cache action');
}
function expectedBlindInputs(day) {
  return {
    photos:day.photos.map((photo,index)=>({name:`audit_${photo.sha256}_${index}${path.extname(photo.file)}`,sha256:photo.sha256})),
    pdfs:day.pdfs.map(pdf=>({name:path.basename(pdf.file),sha256:pdf.sha256})),
  };
}
function assertPlainDirectory(root,name) {
  const target=path.join(root,name),stat=fs.lstatSync(target);
  if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Audit blind input must use plain directories');
  return target;
}
export function assertBlindAuditInputs(day,inputDir) {
  if(fs.lstatSync(inputDir).isSymbolicLink())throw Error('Audit blind input must not be a symbolic link');
  const expected=expectedBlindInputs(day),root=fs.realpathSync(inputDir),photoDir=assertPlainDirectory(root,'1');
  const exactNames=(directory,pattern)=>fs.readdirSync(directory,{withFileTypes:true}).filter(entry=>pattern.test(entry.name)).map(entry=>{
    if(entry.isSymbolicLink()||!entry.isFile())throw Error('Audit blind input contains a non-file entry');
    return entry.name;
  }).sort();
  const actualPhotos=exactNames(photoDir,/\.(jpe?g|png)$/i);
  const actualPdfs=exactNames(root,/\.pdf$/i);
  const expectedPhotoNames=expected.photos.map(item=>item.name).sort(),expectedPdfNames=expected.pdfs.map(item=>item.name).sort();
  if(JSON.stringify(actualPhotos)!==JSON.stringify(expectedPhotoNames)||JSON.stringify(actualPdfs)!==JSON.stringify(expectedPdfNames))
    throw Error('Audit blind input set does not exactly match inventory');
  for(const item of expected.photos)if(fileSha(path.join(photoDir,item.name))!==item.sha256)throw Error('Audit blind photo copy changed');
  for(const item of expected.pdfs)if(fileSha(path.join(root,item.name))!==item.sha256)throw Error('Audit blind PDF copy changed');
  return sha(JSON.stringify(expected));
}

export function sealAuditReport(report,{day,action,appRoot,dir,inputDir=path.join(dir,'input')}) {
  assertAuditOriginalsUnchanged(day);
  if(report.error||report.status==='missing-source-material'||report.sourceUnchanged!==true)throw Error('Incomplete audit cannot be sealed');
  const blindInputDigest=action==='replay'?assertBlindAuditInputs(day,inputDir):null;
  const {cacheBinding:discard,...payload}=report;
  const binding={schemaVersion:2,action,inputDigest:inputDigest(day),blindInputDigest,auditProgramDigest:auditProgramDigest(appRoot),
    artifacts:artifactsFor(action).map(name=>({name,sha256:fileSha(path.join(dir,name))}))};
  return {...payload,cacheBinding:{...binding,digest:sha(JSON.stringify({payload,binding}))}};
}

export function assertReusableAuditReport(report,{day,action,appRoot,dir,sourceHash,inputDir=path.join(dir,'input')}) {
  // Always reread actual originals, even for a green saved report.
  assertAuditOriginalsUnchanged(day);
  try {
    if(!report||report.sourceHash!==sourceHash||report.date!==day.date||report.error||report.sourceUnchanged!==true)throw Error();
    const {cacheBinding,...payload}=report;
    if(!cacheBinding||cacheBinding.schemaVersion!==2||cacheBinding.action!==action)throw Error();
    const {digest,...binding}=cacheBinding;
    if(digest!==sha(JSON.stringify({payload,binding}))||binding.inputDigest!==inputDigest(day)
      ||binding.auditProgramDigest!==auditProgramDigest(appRoot))throw Error();
    const expected=artifactsFor(action);
    if(!Array.isArray(binding.artifacts)||binding.artifacts.length!==expected.length)throw Error();
    for(const [index,name] of expected.entries()) {
      const saved=binding.artifacts[index];
      if(saved.name!==name||!validSha(saved.sha256)||fileSha(path.join(dir,name))!==saved.sha256)throw Error();
    }
    const blindInputDigest=action==='replay'?assertBlindAuditInputs(day,inputDir):null;
    if(binding.blindInputDigest!==blindInputDigest)throw Error();
  } catch {
    throw Error('Cached audit report is stale or incomplete; preserve it and use a fresh private audit directory');
  }
  return true;
}
