import crypto from 'node:crypto';
import {validDetectedCodeReview} from '../../src/detected-code-reader.mjs';
const digest=row=>crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
export function sealDetectionRow(row,identity){
  const result={...row,schemaVersion:2,identity};
  return {...result,evidenceSha256:digest(result)};
}
export function canReuseDetectionRow(row,identity,currentSourceSha256){
  if(!row||!validDetectedCodeReview(row)||row.schemaVersion!==2||row.error||row.sourceUnchanged!==true
    ||row.bindingVerified!==false||row.engines!==2||row.errors!==0
    ||currentSourceSha256!==identity.sha256||row.sha256!==identity.sha256)return false;
  if(!['sourceVersion','modelSha256','date','sha256'].every(key=>row.identity?.[key]===identity[key]))return false;
  const {evidenceSha256,...payload}=row;
  if(typeof evidenceSha256!=='string'||digest(payload)!==evidenceSha256)return false;
  if(!(row.confirmed===null||(Number.isInteger(row.confirmed)&&row.confirmed>0)))return false;
  const coverage=row.coverage;
  if(!coverage||typeof coverage.completed!=='boolean'
    ||!Number.isInteger(row.regions)||row.regions<0
    ||!Number.isInteger(coverage.eligibleRegions)||coverage.eligibleRegions<0||coverage.eligibleRegions>row.regions
    ||!Number.isInteger(coverage.processedRegions)||coverage.processedRegions<0
    ||coverage.processedRegions!==Math.min(coverage.eligibleRegions,300))return false;
  if(coverage.completed&&(coverage.processedRegions!==coverage.eligibleRegions||row.regions>=1000))return false;
  if(!coverage.completed&&row.confirmed!==null)return false;
  if(!Array.isArray(row.observations)||!Array.isArray(row.independent)||!Array.isArray(row.readings)
    ||row.readings.length!==coverage.processedRegions*4)return false;
  const views=new Set(),regions=new Set();
  for(const r of row.readings){
    if(!['paddle','tesseract'].includes(r.engine)||![.45,.75].includes(r.padding)
      ||!Number.isInteger(r.index)||r.index<0||r.index>=row.regions||r.errorCode!==null)return false;
    const key=`${r.engine}:${r.index}:${r.padding}`;
    if(views.has(key))return false;
    views.add(key);regions.add(r.index);
  }
  return regions.size===coverage.processedRegions;
}
export function detectionErrorCount(rows){
  return rows.filter(row=>row.error||Number(row.errors)>0||row.readings?.some(r=>r.errorCode)).length;
}
