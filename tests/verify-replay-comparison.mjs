// Evidence integrity only. Does not recognize, rename, upload, or prove orders.
// Reports and original materials must remain in the private local audit root.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {recognitionSourceFingerprint} from '../src/recognition-provenance.mjs';
import {summarizeProductReplay} from './audit-replay-summary.mjs';
import {requirePrivateAuditRoot} from './audit-paths.mjs';

const read=file=>JSON.parse(fs.readFileSync(file));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sorted=rows=>rows.map(r=>JSON.stringify(r)).sort();

export function compareReplayRows(previous,current) {
  assert.deepEqual(previous.map(r=>r.sha256),current.map(r=>r.sha256),'Different source photo multiset or ordering');
  const changes=current.flatMap((row,i)=>row.assigned===previous[i].assigned&&row.kind===previous[i].kind?[]:[{
    sha256:row.sha256,before:previous[i].assigned,after:row.assigned,
    beforeKind:previous[i].kind,afterKind:row.kind,
  }]);
  return {changes,added:changes.filter(r=>!r.before&&r.after).length,
    removed:changes.filter(r=>r.before&&!r.after).length,
    reassigned:changes.filter(r=>r.before&&r.after).length};
}

export function verifyReplayComparison({auditRoot,frozenRoot,baselineRound,dates,output}) {
  requirePrivateAuditRoot(auditRoot);
  if(!/^replay-[a-f0-9]{12}$/.test(baselineRound))throw Error('Invalid baseline round');
  if(!dates.length||new Set(dates).size!==dates.length||dates.some(d=>!/^2026-\d{2}-\d{2}$/.test(d)))throw Error('Explicit unique dates required');
  requirePrivateAuditRoot(path.dirname(output));
  const fingerprint=recognitionSourceFingerprint(frozenRoot),round='replay-'+fingerprint.slice(0,12);
  const inventory=read(path.join(auditRoot,'inventory.json'));
  const result={schemaVersion:1,at:new Date().toISOString(),sourceFingerprint:fingerprint,baselineRound,
    integrityVerified:false,orderBindingVerified:false,releaseAccepted:false,days:[]};
  for(const date of dates) {
    const days=inventory.days.filter(d=>d.date===date);assert.equal(days.length,1);
    const day=days[0],dir=path.join(auditRoot,round,date);
    const report=read(path.join(dir,'report.json')),plan=read(path.join(dir,'private-plan.json'));
    const mapping=read(path.join(dir,'private-source-map.json'));
    const oldDir=path.join(auditRoot,baselineRound,date),previous=read(path.join(oldDir,'report.json')),oldPlan=read(path.join(oldDir,'private-plan.json'));
    assert.equal(report.sourceHash,fingerprint);
    assert.equal(summarizeProductReplay(round,[day],[{date,report}]).completedDays,1);
    assert.equal(plan.businessDate,date);assert.equal(plan.pdfIndexBinding.recognizerFingerprint,fingerprint);
    assert.deepEqual(mapping.map(r=>r.sha256),day.photos.map(r=>r.sha256));
    assert.deepEqual(report.rows.map(r=>r.sha256),day.photos.map(r=>r.sha256));
    assert.deepEqual(sorted(plan.photoInputBinding.files),sorted(mapping.map(r=>({name:r.blindName,sha256:r.sha256}))));
    assert.deepEqual(sorted(plan.pdfIndexBinding.files),sorted(day.pdfs.map(r=>({name:path.basename(r.file),sha256:r.sha256}))));
    assert.deepEqual(sorted(oldPlan.pdfIndexBinding.files),sorted(plan.pdfIndexBinding.files));
    for(const file of [...day.photos,...day.pdfs])assert.equal(hash(file.file),file.sha256,'Original changed');
    for(const photo of mapping)assert.equal(hash(path.join(plan.photoDir,photo.blindName)),photo.sha256,'Blind copy changed');
    for(const pdf of day.pdfs)assert.equal(hash(path.join(dir,'input',path.basename(pdf.file))),pdf.sha256,'PDF copy changed');
    const pageIds=plan.pdfPages.map(p=>[p.pdfName,p.pageNumber,p.number]);
    assert.deepEqual(oldPlan.pdfPages.map(p=>[p.pdfName,p.pageNumber,p.number]),pageIds,'PDF physical pages/codes changed');
    assert.equal(new Set(pageIds.map(p=>JSON.stringify(p.slice(0,2)))).size,pageIds.length);
    assert.equal(plan.pdfPages.length,report.pdfPages);
    const byName=new Map(mapping.map(r=>[r.blindName,r.sha256]));
    const assigned=plan.assignments.map(a=>{const sha=byName.get(path.basename(a.source));assert.ok(sha);return [sha,a.targetName,a.kind];});
    assert.equal(new Set(plan.assignments.map(a=>a.source)).size,assigned.length);
    assert.equal(new Set(plan.assignments.map(a=>a.targetName)).size,assigned.length);
    assert.deepEqual(sorted(assigned),sorted(report.rows.filter(r=>r.assigned).map(r=>[r.sha256,r.assigned,r.kind])));
    for(const body of plan.bodyClaimReview?.results||[])assert.equal(body.bindingVerified,false);
    const comparison=compareReplayRows(previous.rows,report.rows);
    const codeReviews=plan.recognized.filter(r=>r.detectedCodeRead?.review);
    result.days.push({date,photos:report.photos,pdfPages:report.pdfPages,
      beforeAssignments:previous.assignments,assignments:report.assignments,unresolved:report.unresolved,
      referenceDisagreements:report.referenceDisagreements,manualEvidence:report.manualEvidence,
      seconds:report.seconds,sourceUnchanged:true,...comparison,
      contrastReviewPhotos:codeReviews.length,
      contrastReadings:codeReviews.reduce((s,r)=>s+r.detectedCodeRead.review.readings.length,0)});
  }
  assert.equal(recognitionSourceFingerprint(frozenRoot),fingerprint,'Frozen source changed');
  result.integrityVerified=true;
  result.note='Historical filenames are references, not ground truth. Added assignments still require order-binding and end-to-end acceptance. No timing is re-counted by this verifier.';
  fs.writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [auditRoot,frozenRoot,baselineRound,output,...dates]=process.argv.slice(2);
  const result=verifyReplayComparison({auditRoot,frozenRoot,baselineRound,output,dates});
  console.log(JSON.stringify({...result,days:result.days.map(({changes,...counts})=>counts)},null,2));
}
