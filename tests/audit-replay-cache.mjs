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
function assertCopiedInputs(day,dir) {
  const entries=[
    ...day.photos.map((photo,index)=>[path.join('input','1',`audit_${photo.sha256}_${index}${path.extname(photo.file)}`),photo.sha256]),
    ...day.pdfs.map(pdf=>[path.join('input',path.basename(pdf.file)),pdf.sha256]),
  ];
  for(const [relative,expected] of entries)if(fileSha(path.join(dir,relative))!==expected)throw Error('Audit input copy changed');
}

export function sealAuditReport(report,{day,action,appRoot,dir}) {
  assertAuditOriginalsUnchanged(day);
  if(report.error||report.status==='missing-source-material'||report.sourceUnchanged!==true)throw Error('Incomplete audit cannot be sealed');
  if(action==='replay')assertCopiedInputs(day,dir);
  const {cacheBinding:discard,...payload}=report;
  const binding={schemaVersion:1,action,inputDigest:inputDigest(day),auditProgramDigest:auditProgramDigest(appRoot),
    artifacts:artifactsFor(action).map(name=>({name,sha256:fileSha(path.join(dir,name))}))};
  return {...payload,cacheBinding:{...binding,digest:sha(JSON.stringify({payload,binding}))}};
}

export function assertReusableAuditReport(report,{day,action,appRoot,dir,sourceHash}) {
  // Always reread actual originals, even for a green saved report.
  assertAuditOriginalsUnchanged(day);
  try {
    if(!report||report.sourceHash!==sourceHash||report.date!==day.date||report.error||report.sourceUnchanged!==true)throw Error();
    const {cacheBinding,...payload}=report;
    if(!cacheBinding||cacheBinding.schemaVersion!==1||cacheBinding.action!==action)throw Error();
    const {digest,...binding}=cacheBinding;
    if(digest!==sha(JSON.stringify({payload,binding}))||binding.inputDigest!==inputDigest(day)
      ||binding.auditProgramDigest!==auditProgramDigest(appRoot))throw Error();
    const expected=artifactsFor(action);
    if(!Array.isArray(binding.artifacts)||binding.artifacts.length!==expected.length)throw Error();
    for(const [index,name] of expected.entries()) {
      const saved=binding.artifacts[index];
      if(saved.name!==name||!validSha(saved.sha256)||fileSha(path.join(dir,name))!==saved.sha256)throw Error();
    }
    if(action==='replay')assertCopiedInputs(day,dir);
  } catch {
    throw Error('Cached audit report is stale or incomplete; preserve it and use a fresh private audit directory');
  }
  return true;
}
