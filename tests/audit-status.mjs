// Aggregate counters only. Source paths, OCR text and customer data are never
// included in this summary; detailed evidence stays in the private audit root.
import fs from 'node:fs';
import path from 'node:path';
import {requirePrivateAuditRoot} from './audit-paths.mjs';
import {summarizeBodyProbeReports} from './experiments/body-probe-summary.mjs';
import {summarizeVisualBodyComparison} from './experiments/pdf-visual-body-summary.mjs';
import {summarizeProductReplay} from './audit-replay-summary.mjs';
const root=requirePrivateAuditRoot(process.argv[2]);
const inventory=JSON.parse(fs.readFileSync(path.join(root,'inventory.json')));
const rounds=[],bodyProbeRounds=[],visualBodyProbeRounds=[];
for(const entry of fs.readdirSync(root,{withFileTypes:true})) {
  if(entry.isDirectory()&&/^pdf-visual-body-probe-[A-Za-z0-9]+$/.test(entry.name)) {
    const dir=path.join(root,entry.name),file=path.join(dir,'summary.json');
    if(!fs.existsSync(file)) {
      visualBodyProbeRounds.push({round:entry.name,status:fs.existsSync(path.join(dir,'failed.json'))?'FAILED_PROBE_NOT_SCORED':'INCOMPLETE_PROBE_NOT_SCORED'});
    } else try {
      const pairs=fs.readdirSync(dir).filter(name=>/^[a-f0-9]{64}-report\.json$/.test(name))
        .map(name=>JSON.parse(fs.readFileSync(path.join(dir,name))));
      visualBodyProbeRounds.push({round:entry.name,...summarizeVisualBodyComparison(JSON.parse(fs.readFileSync(file)),pairs)});
    } catch { visualBodyProbeRounds.push({round:entry.name,status:'INVALID_PROBE_NOT_SCORED'}); }
  }
  if(entry.isDirectory()&&/^body-text-probe-[A-Za-z0-9]+$/.test(entry.name)) {
    const dir=path.join(root,entry.name),completion=path.join(dir,'summary.json');
    if(!fs.existsSync(completion)) {
      bodyProbeRounds.push({round:entry.name,status:'INCOMPLETE_PROBE_NOT_SCORED'});
    } else try {
      const complete=JSON.parse(fs.readFileSync(completion));
      const reports=fs.readdirSync(dir,{withFileTypes:true})
        .filter(item=>item.isDirectory()&&/^[a-f0-9]{12}$/.test(item.name))
        .map(item=>JSON.parse(fs.readFileSync(path.join(dir,item.name,'report.json'))));
      if(reports.length!==complete.summaries?.length||reports.some(r=>r.sourceFingerprint!==complete.sourceFingerprint))throw Error('Incomplete probe');
      if(reports.every(r=>r.modelSha256===null||r.modelSha256===undefined)) {
        bodyProbeRounds.push({round:entry.name,status:'WINDOWS_ONLY_PROBE_NOT_SCORED',photos:reports.length});
      } else {
        const summary=summarizeBodyProbeReports(reports);
        bodyProbeRounds.push({round:entry.name,status:summary.status,sourceFingerprint:summary.sourceFingerprint,
          modelSha256:summary.modelSha256,photos:summary.photos,counts:summary.counts,note:summary.note});
      }
    } catch {
      // Never echo parse/model errors that might include private paths or text.
      bodyProbeRounds.push({round:entry.name,status:'INVALID_PROBE_NOT_SCORED'});
    }
  }
  if(!entry.isDirectory()||! /^(?:replay|structure|pdf-index|detection)-[a-f\d]+$/.test(entry.name))continue;
  if(entry.name.startsWith('replay-')) {
    const records=[];
    for(const day of fs.readdirSync(path.join(root,entry.name),{withFileTypes:true})) {
      if(!day.isDirectory()||!/^2026-\d\d-\d\d$/.test(day.name))continue;
      const file=path.join(root,entry.name,day.name,'report.json');
      if(!fs.existsSync(file))continue;
      let report=null;try {report=JSON.parse(fs.readFileSync(file));} catch {}
      records.push({date:day.name,report});
    }
    rounds.push(summarizeProductReplay(entry.name,inventory.days,records));continue;
  }
  const round=path.join(root,entry.name),reports=[];
  let checkpointPhotos=0;
  for(const day of fs.readdirSync(round,{withFileTypes:true})) {
    if(!day.isDirectory()||!/^2026-\d\d-\d\d$/.test(day.name))continue;
    const dir=path.join(round,day.name);
    if(entry.name.startsWith('detection-'))checkpointPhotos+=fs.readdirSync(dir).filter(name=>/^[a-f\d]{64}\.json$/.test(name)).length;
    for(const name of ['summary.json','report.json']) {
      const file=path.join(dir,name);if(fs.existsSync(file))reports.push(JSON.parse(fs.readFileSync(file)));
    }
  }
  const sum=name=>reports.reduce((n,r)=>n+(Number(r[name])||0),0);
  rounds.push({round:entry.name,completedDays:reports.length,plannedDays:inventory.days.length,
    failedDays:reports.filter(r=>r.error).length,photos:sum('photos'),checkpointPhotos,pages:sum('pages'),
    confirmed:sum('confirmed'),unresolved:sum('unresolved')+sum('paperUnresolved'),unreadPdf:sum('unread'),
    duplicatePdfNumbers:sum('duplicates'),referenceDisagreements:sum('referenceDisagreements'),
    referencePhotoNumbersAbsentFromPdf:sum('referenceNumbersAbsent'),
    sourceVerifiedDays:reports.filter(r=>r.sourceUnchanged===true).length,
    sourceChanges:reports.filter(r=>r.sourceUnchanged===false).length,seconds:sum('seconds'),
    note:'Reference labels are historical filenames, not independent ground truth. Coverage is not acceptance.'});
}
const status={generatedAt:new Date().toISOString(),status:'INCOMPLETE_NOT_RELEASE_ACCEPTANCE',
  inventory:{days:inventory.days.length,photos:inventory.days.reduce((n,d)=>n+d.photos.length,0),pdfs:inventory.days.reduce((n,d)=>n+d.pdfs.length,0)},rounds,bodyProbeRounds,visualBodyProbeRounds};
const output=path.join(root,'current-status.json');fs.writeFileSync(output+'.tmp',JSON.stringify(status,null,2));fs.renameSync(output+'.tmp',output);
console.log(JSON.stringify(status));
