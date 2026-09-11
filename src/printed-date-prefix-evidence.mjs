// Business-header evidence, not a date inferred from a folder, filename, clock,
// missing PDF slot or UI selection. This module alone never authorizes a photo.
import crypto from 'node:crypto';
import {validPositionedBodyViews} from './body-positioned-observation.mjs';
import {visualBodyViewNames} from './pdf-visual-body-evidence.mjs';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const sameCrop=(a,b)=>a&&b&&['left','top','width','height'].every(k=>a[k]===b[k]);
const oneSubstitution=(a,b)=>a.length===b.length&&[...a].filter((c,i)=>c!==b[i]).length===1;
const credible=o=>o.confidence>=(o.engine==='paddle'?.65:30);

export function printedDatePrefixSeed(read,rows,expectedPrefix) {
 if(!read||read.expectedPrefix!==expectedPrefix||read.nativeScaleReview||!Array.isArray(rows)||rows.length!==2
   ||rows.some(r=>r.confidence<.85||r.incompleteTailObserved||r.codes?.length!==1))return null;
 const original=read.observations.filter(o=>o.confidence>=.85),all=[...read.observations,...read.independent],strong=all.filter(credible);
 if(original.length!==2||new Set(original.map(o=>o.padding)).size!==2||sameCrop(original[0].crop,original[1].crop))return null;
 const code=original[0],prefixes=new Set(original.map(o=>o.prefix));
 if(!strong.length||!original.some(o=>o.prefix!==expectedPrefix)
   ||strong.some(o=>o.index!==code.index||o.number!==code.number
     ||(o.prefix!==expectedPrefix&&!oneSubstitution(o.prefix,expectedPrefix))))return null;
 for(const r of rows){
  const source=original.find(o=>o.index===r.index&&o.padding===r.padding);
  if(!source||!sameCrop(source.crop,r.crop)||r.codes[0].number!==code.number
    ||(!prefixes.has(r.codes[0].prefix)&&r.codes[0].prefix!==expectedPrefix))return null;
 }
 if(new Set(rows.map(r=>r.padding)).size!==2)return null;
 // Two independent original engines agreeing on an opposite word remain a
 // veto. A title date or another Paddle model must not erase that evidence.
 for(const word of new Set(strong.filter(o=>o.prefix!==expectedPrefix).map(o=>o.fullCode))){
  if(['paddle','tesseract'].every(engine=>new Set(strong.filter(o=>o.engine===engine&&o.fullCode===word).map(o=>o.padding)).size===2))return null;
 }
 return {number:code.number,prefix:expectedPrefix,fullCode:`${expectedPrefix}-1-${code.number}`,
  fullCodeObserved:false,requiresPrintedDate:true,codePolicy:'stable-tail-printed-date-current-body-v1',
  observedFullCodes:[...new Set(strong.map(o=>o.fullCode))].sort(),codeSupport:structuredClone(rows)};
}

function header(text,visualPdf=false){
 if(typeof text!=='string'||/[\r\n\u2028\u2029]/u.test(text))return null;
 const value=text.normalize('NFKC').replace(/[ \t\u3000]/gu,'');
 const m=/^(20\d{2})年(\d{1,2})月(\d{1,2})日(供灯祈\p{Script=Han})$/u.exec(value);
 // PDF visual OCR corroborates the DATE and the printed lamp context. Its
 // last non-date Han glyph is not date evidence. Photo pairs and PDF text
 // extraction must still contain the exact complete business heading.
 if(!m||(!visualPdf&&m[4]!=='供灯祈愿'))return null;
 const y=Number(m[1]),month=Number(m[2]),day=Number(m[3]),d=new Date(Date.UTC(y,month-1,day));
 if(d.getUTCFullYear()!==y||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return null;
 return {date:`${m[1]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,
  prefix:`${m[1].slice(-2)}${month}`,kind:'lamp-prayer-header'};
}
function oneHeader(texts,visualPdf=false){
 if(!Array.isArray(texts))return null;
 const candidates=texts.filter(t=>typeof t==='string'&&/\d.*供灯祈/u.test(t));
 if(candidates.length!==1)return null;
 return header(candidates[0],visualPdf);
}
const sameHeader=(a,b)=>a&&b&&a.date===b.date&&a.kind===b.kind;

export function printedDateSupport({views,pages,read,expectedPrefix},target){
 if(!validPositionedBodyViews(views))return null;
 const ordered=visualBodyViewNames.map(n=>views.find(v=>v.view===n));
 if(ordered.some(v=>v.positioned.dimensions.width!==read.sourceDimensions.width
   ||v.positioned.dimensions.height!==read.sourceDimensions.height))return null;
 const photo=ordered.slice(0,2).map(v=>{
  const h=oneHeader(v.positioned.fields.map(f=>f.text));
  const fields=v.positioned.fields.filter(f=>sameHeader(header(f.text),h));
  return h&&fields.length===1?{h,field:fields[0]}:null;
 });
 if(photo.some(v=>!v||v.field.confidence<.85)||!sameHeader(photo[0].h,photo[1].h)
   ||photo[0].h.prefix!==expectedPrefix||photo[0].field.regionIndex!==photo[1].field.regionIndex
   ||sameCrop(photo[0].field.crop,photo[1].field.crop))return null;
 // Any additional complete business header is contrary evidence, even if its
 // body has less text. No heading fragments or best-score selection.
 for(const v of ordered)for(const f of v.positioned.fields){
  const h=header(f.text);if(h&&!sameHeader(h,photo[0].h))return null;
 }
 const matches=pages.filter(p=>p.pdfSha256===target.pdfSha256&&p.pageNumber===target.pageNumber);
 if(matches.length!==1)return null;
 const page=matches[0],extracted=oneHeader(page.fieldTexts);
 if(!sameHeader(extracted,photo[0].h)||!Array.isArray(page.visibleFieldViews))return null;
 for(const v of page.visibleFieldViews){
  if(typeof v.text!=='string')return null;
  for(const line of v.text.split(/[。\r\n\u2028\u2029]/u)){
   const h=header(line,true);if(h&&!sameHeader(h,extracted))return null;
  }
 }
 const visible=visualBodyViewNames.slice(0,2).map(name=>{
  const vs=page.visibleFieldViews.filter(v=>v.view===name);
  if(vs.length!==1||vs[0].errors!==0||vs[0].truncated!==false||typeof vs[0].text!=='string')return null;
  return oneHeader(vs[0].text.split(/[。\r\n\u2028\u2029]/u),true);
 });
 if(visible.some(h=>!sameHeader(h,extracted)))return null;
 return {date:extracted.date,kind:extracted.kind,headerSha256:hash(`${extracted.date}:${extracted.kind}`),
  photoRegionIndex:photo[0].field.regionIndex,views:visualBodyViewNames.slice(0,2),
  extractedAndPairedVisiblePdf:true,derivedFromUiDate:false};
}
