// Private, content-addressed OCR observations. Never cache order decisions.
// The caller supplies its machine-local work directory, not a NAS folder.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {visualBodyViewNames} from './pdf-visual-body-evidence.mjs';
import {validPositionedBodyViews} from './body-positioned-observation.mjs';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const digest=value=>/^[a-f0-9]{64}$/.test(value||'');
const complete=views=>Array.isArray(views)&&views.length===visualBodyViewNames.length
  &&visualBodyViewNames.every(name=>views.filter(v=>v?.view===name).length===1)
  &&views.every(v=>v.errors===0&&v.truncated===false&&typeof v.text==='string');

export async function readBodyObservation({cacheDir,source,fingerprint,modelSha256,read,profile='text-v1'}) {
  if(!['text-v1','positioned-v1'].includes(profile))throw Error('Unsupported body observation profile');
  const sourceSha256=hash(source);
  // Keep legacy text keys stable; position-required reads have a separate key.
  const identity={schemaVersion:1,sourceSha256,fingerprint,modelSha256,
    ...(profile==='positioned-v1'?{profile}:{})};
  const acceptable=views=>complete(views)&&(profile==='text-v1'||validPositionedBodyViews(views));
  const enabled=cacheDir&&digest(fingerprint)&&digest(modelSha256);
  const file=enabled?path.join(cacheDir,`${hash(JSON.stringify(identity))}.json`):null;
  if(file)try {
    if(fs.statSync(file).size<=16*1024*1024) {
      const entry=JSON.parse(fs.readFileSync(file,'utf8'));
      if(Object.entries(identity).every(([key,value])=>entry[key]===value)
        &&acceptable(entry.views)&&entry.viewsSha256===hash(JSON.stringify(entry.views)))
        return {views:entry.views,cacheHit:true,sourceSha256};
    }
  } catch { /* Cache miss/corruption: re-read source, never count as success. */ }
  const views=await read(source);
  if(profile==='positioned-v1'&&!acceptable(views))throw Error('Incomplete or invalid positioned body observations');
  if(file&&acceptable(views)) {
    let temporary=null;
    try {
      fs.mkdirSync(cacheDir,{recursive:true});
      temporary=`${file}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(temporary,JSON.stringify({...identity,views,viewsSha256:hash(JSON.stringify(views))}),{flag:'wx'});
      fs.renameSync(temporary,file);
    } catch { /* A read-only/full cache volume must not change OCR evidence. */ }
    finally {if(temporary&&fs.existsSync(temporary))try {fs.unlinkSync(temporary);}catch{}}
  }
  return {views,cacheHit:false,sourceSha256};
}
