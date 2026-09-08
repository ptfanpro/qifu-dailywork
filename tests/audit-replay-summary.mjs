// Counts only. A finished offline plan is not a verified order binding.
export function summarizeProductReplay(round,inventoryDays,records) {
  const prefix=/^replay-([a-f0-9]+)$/.exec(round)?.[1];
  const result={round,reportedDays:records.length,completedDays:0,plannedDays:inventoryDays.length,
    failedDays:0,invalidDays:0,missingSourceDays:0,photos:0,pages:0,assignedPhotos:0,confirmed:null,
    unresolved:0,referenceDisagreements:0,manualEvidence:0,readyDays:0,sourceVerifiedDays:0,sourceChanges:0,
    seconds:0,failedSeconds:0,note:'Frozen product plan counts, not order binding or release acceptance. Historical filenames are references, not ground truth.'};
  const seen=new Set(),fingerprints=new Set();
  const integer=n=>Number.isSafeInteger(n)&&n>=0;
  const hashes=rows=>rows.map(r=>r.sha256).sort();
  for(const {date,report:r} of records){
    const day=inventoryDays.find(d=>d.date===date);
    if(!day||seen.has(date)||!r||r.date!==date||!prefix||! /^[a-f0-9]{64}$/.test(r.sourceHash||'')||!r.sourceHash.startsWith(prefix)){
      result.invalidDays++;continue;
    }
    seen.add(date);fingerprints.add(r.sourceHash);
    if(r.error){result.failedDays++;if(Number.isFinite(r.seconds)&&r.seconds>=0)result.failedSeconds+=r.seconds;continue;}
    if(r.status==='missing-source-material'){
      if((day.photos.length===0||day.pdfs.length===0)&&r.photos===day.photos.length&&r.pdfs===day.pdfs.length)result.missingSourceDays++;
      else result.invalidDays++;
      continue;
    }
    if(r.sourceUnchanged===false){result.sourceChanges++;continue;}
    const valid=['photos','pdfPages','assignments','unresolved','referenceDisagreements','manualEvidence'].every(k=>integer(r[k]))
      && r.sourceUnchanged===true && Number.isFinite(r.seconds)&&r.seconds>=0
      && typeof r.ready==='boolean'&&typeof r.safeToApply==='boolean'
      && Array.isArray(r.rows)&&r.rows.length===r.photos&&r.photos===day.photos.length
      && r.rows.every(row=>row&&/^[a-f0-9]{64}$/.test(row.sha256||'')&&typeof row.disagreement==='boolean')
      && JSON.stringify(hashes(r.rows))===JSON.stringify(hashes(day.photos))
      && r.rows.every(row=>(row.assigned===null&&row.kind===null)||(typeof row.assigned==='string'&&['blessing','scene-lamp','scene-water'].includes(row.kind)))
      && r.rows.filter(row=>row.assigned!==null).every(row=>/^(?:\d+|2\.[1256])\.jpg$/i.test(row.assigned))
      && new Set(r.rows.filter(row=>row.assigned!==null).map(row=>row.assigned.toLowerCase())).size===r.assignments
      && r.assignments===r.rows.filter(row=>row.assigned!==null).length
      && r.unresolved===r.rows.filter(row=>row.assigned===null).length
      && r.referenceDisagreements===r.rows.filter(row=>row.disagreement===true).length
      && r.manualEvidence===r.rows.filter(row=>/manual/.test(row.method||'')).length;
    if(!valid){result.invalidDays++;continue;}
    result.completedDays++;result.sourceVerifiedDays++;
    result.photos+=r.photos;result.pages+=r.pdfPages;result.assignedPhotos+=r.assignments;
    result.unresolved+=r.unresolved;result.referenceDisagreements+=r.referenceDisagreements;
    result.manualEvidence+=r.manualEvidence;result.readyDays+=Number(r.ready);result.seconds+=r.seconds;
  }
  // A truncated directory name must not merge different full source identities.
  if(fingerprints.size>1)return {round,reportedDays:records.length,plannedDays:inventoryDays.length,
    status:'MIXED_SOURCE_NOT_SCORED',invalidDays:records.length,completedDays:0,confirmed:null};
  return result;
}
