// Offline historical audit. Never calls applyPhotoPreparation, the runner or
// a browser. Private file mappings and evidence stay outside the source repo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {planPhotoPreparation,diagnosePhotoStructure,classifySceneVisualScore} from '../src/photo-prepare.mjs';
import {recognitionSourceFingerprint} from '../src/recognition-provenance.mjs';
import {requirePrivateAuditRoot} from './audit-paths.mjs';

const [action,businessRoot,outputRoot,...filters]=process.argv.slice(2);
if(!['inventory','structure','replay'].includes(action)||!businessRoot||!outputRoot) throw Error('inventory|structure|replay BUSINESS_ROOT PRIVATE_OUTPUT [YYYY-MM-DD...]');
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const inside=(parent,child)=>{const rel=path.relative(path.resolve(parent),path.resolve(child));return !rel||(!rel.startsWith('..')&&!path.isAbsolute(rel));};
if(inside(businessRoot,outputRoot)||inside(appRoot,outputRoot)) throw Error('Private output must be outside business and source roots');
requirePrivateAuditRoot(outputRoot);
fs.mkdirSync(outputRoot,{recursive:true});
const json=(file,value)=>{const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,file);};
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inventoryFile=path.join(outputRoot,'inventory.json');
const sourceVersion=JSON.parse(fs.readFileSync(path.join(appRoot,'package.json'))).version;
const sourceHash=recognitionSourceFingerprint(appRoot);
if(action==='inventory') {
  const days=[];
  // Deliberately no recursive root scan: forbidden legacy runtime folders are
  // not entered. Only explicit 2026 business-day directories are candidates.
  for(const entry of fs.readdirSync(businessRoot,{withFileTypes:true})) {
    const match=/^(\d{1,2})月(\d{1,2})日$/.exec(entry.name);
    if(!match||!entry.isDirectory()) continue;
    const month=Number(match[1]),day=Number(match[2]);
    const date=`2026-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    if(filters.length&&!filters.includes(date)) continue;
    if(new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date) continue;
    const folder=path.join(businessRoot,entry.name),photoDir=path.join(folder,'1');
    const describe=(file)=>({file,size:fs.statSync(file).size,sha256:sha(file)});
    const pdfs=fs.readdirSync(folder).filter(n=>/\.pdf$/i.test(n)).map(n=>describe(path.join(folder,n)));
    const photos=fs.existsSync(photoDir)?fs.readdirSync(photoDir).filter(n=>/\.(jpe?g|png)$/i.test(n)).map(n=>({
      ...describe(path.join(photoDir,n)),
      referenceLabel:/^\d+$/.test(path.parse(n).name)?'blessing':/^2\.[12]$/.test(path.parse(n).name)?'scene-lamp':/^2\.[56]$/.test(path.parse(n).name)?'scene-water':'unlabelled',
      referenceNumber:/^\d+$/.test(path.parse(n).name)?Number(path.parse(n).name):null,
    })):[];
    days.push({date,folder,photoDir,pdfs,photos});
    if(days.length%20===0) console.log(JSON.stringify({stage:'inventory',days:days.length}));
  }
  days.sort((a,b)=>a.date.localeCompare(b.date));
  json(inventoryFile,{schemaVersion:1,sourceVersion,sourceHash,createdAt:new Date().toISOString(),labelAuthority:'historical-filename-reference-not-independent-ground-truth',days});
  console.log(JSON.stringify({stage:'inventory-complete',days:days.length,photos:days.reduce((n,d)=>n+d.photos.length,0),pdfs:days.reduce((n,d)=>n+d.pdfs.length,0),first:days[0]?.date,last:days.at(-1)?.date}));
} else {
  const inventory=JSON.parse(fs.readFileSync(inventoryFile));
  const days=inventory.days.filter(d=>!filters.length||filters.includes(d.date));
  for(const day of days) {
    const dir=path.join(outputRoot,`${action}-${sourceHash.slice(0,12)}`,day.date);fs.mkdirSync(dir,{recursive:true});
    const reportFile=path.join(dir,'report.json');
    if(fs.existsSync(reportFile)) {
      const previous=JSON.parse(fs.readFileSync(reportFile));
      if(previous.sourceHash===sourceHash&&!previous.error)continue;
    }
    if(recognitionSourceFingerprint(appRoot)!==sourceHash)throw Error('Recognition snapshot changed; resume from a frozen snapshot');
    const started=Date.now();
    if(action==='structure') {
      const rows=[];
      for(const photo of day.photos) {
        try {
          const result=await diagnosePhotoStructure(photo.file);
          rows.push({sha256:photo.sha256,referenceLabel:photo.referenceLabel,...result,
            category:classifySceneVisualScore(result.sceneMetrics),sourceUnchanged:sha(photo.file)===photo.sha256});
        } catch { rows.push({sha256:photo.sha256,referenceLabel:photo.referenceLabel,error:'image-decode-or-structure-failure'}); }
      }
      const summary={date:day.date,photos:rows.length,sourceHash,sourceVersion,seconds:(Date.now()-started)/1000,
        decodeErrors:rows.filter(r=>r.error).length,sourceUnchanged:rows.every(r=>r.sourceUnchanged===true),
        referencePaperSceneDisagreements:rows.filter(r=>r.referenceLabel==='blessing'&&r.likelyScene).length,
        referenceSceneEntryMisses:rows.filter(r=>r.referenceLabel.startsWith('scene-')&&!r.likelyScene).length};
      json(reportFile,{...summary,rows});console.log(JSON.stringify(summary));
      continue;
    }
    if(!day.photos.length||!day.pdfs.length) {json(reportFile,{sourceHash,date:day.date,status:'missing-source-material',photos:day.photos.length,pdfs:day.pdfs.length});continue;}
    // Blind processed filenames, and do not manufacture capture-order evidence.
    // Different bytes get opaque names sorted by hash, not the old number.
    const folder=path.join(dir,'input'),photoDir=path.join(folder,'1');
    fs.mkdirSync(photoDir,{recursive:true});
    for(const pdf of day.pdfs) {
      if(sha(pdf.file)!==pdf.sha256) throw Error('Source changed since inventory');
      fs.copyFileSync(pdf.file,path.join(folder,path.basename(pdf.file)));
    }
    const mapping=[];
    for(const [index,photo] of day.photos.entries()) {
      if(sha(photo.file)!==photo.sha256) throw Error('Source changed since inventory');
      const name=`audit_${photo.sha256}_${index}${path.extname(photo.file)}`;
      fs.copyFileSync(photo.file,path.join(photoDir,name));mapping.push({...photo,blindName:name});
    }
    json(path.join(dir,'private-source-map.json'),mapping);
    let plan;
    try {
      plan=await planPhotoPreparation({appRoot,folder,photoDir,date:day.date,expectedPrefix:`26${Number(day.date.slice(5,7))}`,workDir:path.join(dir,'state'),
        onProgress:message=>json(path.join(dir,'private-progress.json'),{updatedAt:new Date().toISOString(),date:day.date,message})});
    } catch(error) {
      json(path.join(dir,'private-error.json'),{name:error.name,message:error.message,stack:error.stack});
      const failure={sourceHash,date:day.date,error:'photo-plan-failed',photos:mapping.length,seconds:Math.round((Date.now()-started)/1000)};
      json(reportFile,failure);console.log(JSON.stringify(failure));continue;
    }
    if(recognitionSourceFingerprint(appRoot)!==sourceHash)throw Error('Recognition snapshot changed during replay; results are not acceptance evidence');
    json(path.join(dir,'private-plan.json'),plan);
    const assignments=new Map(plan.assignments.map(a=>[path.basename(a.source),a]));
    const rows=mapping.map(p=>{
      const a=assignments.get(p.blindName),observed=plan.recognized.find(r=>path.basename(r.file)===p.blindName);
      return {sha256:p.sha256,referenceLabel:p.referenceLabel,referenceNumber:p.referenceNumber,assigned:a?.targetName||null,kind:a?.kind||null,
        method:a?.evidence?.method||observed?.evidence?.method||null,
        disagreement:Boolean(a&&p.referenceLabel!=='unlabelled'&&(a.kind!==p.referenceLabel||(a.kind==='blessing'&&Number(path.parse(a.targetName).name)!==p.referenceNumber)))};
    });
    const summary={sourceHash,sourceVersion,date:day.date,photos:mapping.length,pdfPages:plan.pdfPages.length,assignments:plan.assignments.length,
      unresolved:rows.filter(r=>!r.assigned).length,referenceDisagreements:rows.filter(r=>r.disagreement).length,
      manualEvidence:rows.filter(r=>/manual/.test(r.method||'')).length,ready:plan.ready,safeToApply:plan.safeToApply,missing:plan.missingExpected.length,
      issues:plan.issues.length,pending:plan.pendingIssues.length,seconds:Math.round((Date.now()-started)/1000),
      sourceUnchanged:[...day.photos,...day.pdfs].every(f=>sha(f.file)===f.sha256)};
    json(reportFile,{...summary,rows});console.log(JSON.stringify(summary));
  }
}
