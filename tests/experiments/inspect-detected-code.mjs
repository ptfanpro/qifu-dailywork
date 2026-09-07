// Private visual evidence only. Never changes an input, assigns a number or
// supplies historical reference numbers to an OCR engine.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {requirePrivateAuditRoot} from '../audit-paths.mjs';
const sharp=createRequire(import.meta.url)('sharp');
const [root,round,...selectors]=process.argv.slice(2);
requirePrivateAuditRoot(root);
if(!/^detection-[a-f\d]{12}$/.test(round)||!selectors.length||selectors.some(s=>!/^[a-f\d]{64}$/.test(s)))throw Error('PRIVATE_ROOT DETECTION_ROUND PHOTO_SHA256 [...]');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const inventory=JSON.parse(fs.readFileSync(path.join(root,'inventory.json')));
const output=fs.mkdtempSync(path.join(root,'code-visual-review-'));
for(const selector of selectors) {
  const day=inventory.days.find(d=>d.photos.some(p=>p.sha256===selector));
  const photo=day?.photos.find(p=>p.sha256===selector);
  if(!photo)throw Error('Input absent from inventory');
  const source=fs.readFileSync(photo.file);
  if(hash(source)!==selector)throw Error('Source changed since inventory');
  const report=JSON.parse(fs.readFileSync(path.join(root,round,day.date,selector+'.json')));
  const decoded=await sharp(source).rotate().toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true});
  const seen=new Set();let index=0;
  for(const observation of [...(report.observations||[]),...(report.independent||[])]) {
    const r=observation.region,key=JSON.stringify(r);if(!r||seen.has(key))continue;seen.add(key);
    const pad=r.height*.75,left=Math.max(0,Math.floor((r.left-pad)*decoded.info.width));
    const top=Math.max(0,Math.floor((r.top-pad)*decoded.info.height));
    const right=Math.min(decoded.info.width,Math.ceil((r.left+r.width+pad)*decoded.info.width));
    const bottom=Math.min(decoded.info.height,Math.ceil((r.top+r.height+pad)*decoded.info.height));
    const file=path.join(output,`${selector.slice(0,12)}-${index++}.png`);
    fs.writeFileSync(file,await sharp(decoded.data,{raw:decoded.info}).extract({left,top,width:right-left,height:bottom-top})
      .resize({width:(right-left)*8,kernel:'nearest'}).png().toBuffer());
    console.log(JSON.stringify({date:day.date,sha256:selector,visualCrop:file,originalPixelWidth:right-left,originalPixelHeight:bottom-top}));
  }
  const decodedFile=path.join(output,selector.slice(0,12)+'-decoded.png');
  fs.writeFileSync(decodedFile,await sharp(decoded.data,{raw:decoded.info}).resize({width:1800,withoutEnlargement:true}).png().toBuffer());
  if(hash(fs.readFileSync(photo.file))!==selector)throw Error('Source changed during review');
  console.log(JSON.stringify({sha256:selector,decodedImage:decodedFile,sourceUnchanged:true}));
}
