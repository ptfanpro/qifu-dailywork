// Whole-field position corroboration, not an OCR number generator. Geometry
// describes observed ink support, NEVER paper/foreground/order ownership.
import crypto from 'node:crypto';
import {validPositionedBodyViews} from './body-positioned-observation.mjs';
import {visualBodyViewNames} from './pdf-visual-body-evidence.mjs';
import {positionedLayoutEvidence} from './positioned-layout-collector.mjs';
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const textHash=value=>crypto.createHash('sha256').update(value).digest('hex');
const id=p=>`${p.pdfSha256}:${p.pageNumber}`;
const normalize=text=>typeof text==='string'&&!/[\p{C}\r\n\u2028\u2029]/u.test(text)?text.normalize('NFKC').replace(/\s/gu,''):null;
const term=text=>{const value=normalize(text);return /^[\u4e00-\u9fff]{3,40}$/.test(value||'')?value:null;};
const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const area=p=>p.reduce((n,a,i)=>{const b=p[(i+1)%p.length];return n+a[0]*b[1]-a[1]*b[0];},0)/2;
function polygon(p){
 if(!Array.isArray(p)||p.length<3||p.length>10000||p.some(v=>!Array.isArray(v)||v.length!==2||v.some(n=>!Number.isFinite(n)))
  ||Math.abs(area(p))<1e-8)throw Error('Invalid support polygon');
 const sign=Math.sign(area(p));
 if(p.some((a,i)=>cross(a,p[(i+1)%p.length],p[(i+2)%p.length])*sign<-1e-7))throw Error('Nonconvex support');
 return sign>0?p:[...p].reverse();
}
const inside=(point,hull)=>hull.every((a,i)=>cross(a,hull[(i+1)%hull.length],point)>=-1e-7);
function intersection(subject,clip){
 let out=subject;
 for(let i=0;i<clip.length&&out.length;i++){
  const a=clip[i],b=clip[(i+1)%clip.length],input=out;out=[];
  let previous=input.at(-1),d0=cross(a,b,previous);
  for(const current of input){
   const d1=cross(a,b,current),in0=d0>=0,in1=d1>=0;
   if(in0!==in1){const t=d0/(d0-d1);out.push(previous.map((v,k)=>v+t*(current[k]-v)));}
   if(in1)out.push(current);
   previous=current;d0=d1;
  }
 }
 return out.length>=3?Math.abs(area(out)):0;
}
const shapeOK=shape=>Array.isArray(shape)&&shape.length===2&&shape.every(n=>Number.isInteger(n)&&n>=32&&n<=1800);
const rectangle=(r,shape)=>[[r.left,r.top],[r.left+r.width,r.top],[r.left+r.width,r.top+r.height],[r.left,r.top+r.height]]
 .map(([x,y])=>[x*shape[1],y*shape[0]]);
function transform(points,m){
 const denominators=points.map(([x,y])=>m[2][0]*x+m[2][1]*y+m[2][2]);
 if(denominators.some(d=>Math.abs(d)<1e-8)||!denominators.every(d=>Math.sign(d)===Math.sign(denominators[0])))return null;
 const result=points.map(([x,y],i)=>[0,1].map(k=>(m[k][0]*x+m[k][1]*y+m[k][2])/denominators[i]));
 return result.flat().every(Number.isFinite)&&area(result)>0?polygon(result):null;
}
function pairedFields(views){
 if(!validPositionedBodyViews(views))throw Error('Incomplete positioned body');
 const ordered=visualBodyViewNames.map(name=>views.find(v=>v.view===name)),out=[];
 for(const offset of [0,2]){
  const [a,b]=ordered.slice(offset,offset+2).map(v=>v.positioned.fields);
  for(const f of a){
   const value=term(f.text);
   if(!value||a.filter(s=>normalize(s.text)===value).length!==1||b.filter(s=>normalize(s.text)===value).length!==1)continue;
   const matches=b.filter(s=>s.regionIndex===f.regionIndex&&digest(s.region)===digest(f.region)&&term(s.text)===value);
   if(matches.length===1)out.push({text:value,region:f.region,regionIndex:f.regionIndex});
  }
 }
 // A field observed twice in different orientations is not two distinct
 // fields. Nor may repeated locations be pooled into a single occurrence.
 return out.filter(f=>out.filter(g=>g.text===f.text).length===1);
}
function pairs(page,photo,layout){
 if(layout?.evidence?.candidate!==true||layout.evidence.localSupport?.observed!==true)return [];
 const support=layout.evidence.localSupport,m=support.matrix;
 if(!Array.isArray(m)||m.length!==3||m.some(r=>!Array.isArray(r)||r.length!==3||r.some(n=>!Number.isFinite(n))))throw Error('Invalid transform');
 const hull=polygon(support.sourceHull),projectedHull=polygon(support.projectedHull),out=[];
 for(const field of pairedFields(page.views)){
  const matches=pairedFields(photo.views).filter(f=>f.text===field.text);
  if(matches.length!==1)continue;
  const a=rectangle(field.region,page.shape),b=rectangle(matches[0].region,photo.shape);
  if(!a.every(p=>inside(p,hull))||!b.every(p=>inside(p,projectedHull)))continue;
  const projected=transform(a,m);if(!projected)continue;
  const overlap=intersection(projected,b),union=area(projected)+area(b)-overlap;
  // Fixed conservative majority overlap, not a best-score/remaining-slot vote.
  if(union<=0||overlap/union<.5)continue;
  out.push({text:field.text,fieldSha256:textHash(field.text),regionIndex:matches[0].regionIndex,iou:overlap/union});
 }
 return out;
}

function codeWithinProposal(read,fullCode,photo,layout){
 const geometry=layout?.evidence?.geometry,size=photo.views[0].positioned.dimensions;
 if(geometry?.accepted!==true||!['nominal-page','printed-content-envelope'].includes(geometry.scope)
  ||digest(size)!==digest(read.sourceDimensions))return false;
 const envelope=polygon(geometry.points),observations=read.observations.filter(o=>o.fullCode===fullCode&&o.confidence>=.85);
 const supported=observations.filter(o=>{
  const c=o.crop,region={left:c.left/size.width,top:c.top/size.height,width:c.width/size.width,height:c.height/size.height};
  return rectangle(region,photo.shape).every(p=>inside(p,envelope));
 });
 // This only rejects a code from outside the proposed content plane (e.g. a
 // neighbouring/background sheet). It does NOT upgrade a nominal ink envelope
 // to a measured physical paper/code boundary or clear contradictory digits.
 return supported.some(a=>supported.some(b=>a.index===b.index&&a.padding!==b.padding));
}

// Pure diagnostic for negative tests. Its serialized output cannot authorize
// a number: the positive join below separately requires a live worker report.
export function comparePositionedFields(pages,photo,layouts){
 if(!Array.isArray(pages)||!pages.length||pages.length>512||new Set(pages.map(p=>p.id)).size!==pages.length
  ||pages.some(p=>!/^[a-f0-9]{64}:[1-9][0-9]{0,4}$/.test(p.id)||!shapeOK(p.shape)
   ||!Array.isArray(p.fieldTexts)||p.fieldTexts.some(t=>typeof t!=='string'))
  ||!shapeOK(photo.shape)||!Array.isArray(layouts)||layouts.length!==pages.length
  ||layouts.some((p,i)=>p.id!==pages[i].id))throw Error('Incomplete positioned corpus');
 for(const page of pages)pairedFields(page.views);
 pairedFields(photo.views);
 const corpus=pages.map(p=>[...p.fieldTexts,...p.views.flatMap(v=>v.positioned.fields.map(f=>f.text))]
  .flatMap(t=>t.split(/\r\n|[\r\n\u2028\u2029]/u)).map(t=>normalize(t)||''));
 const rows=pages.map((page,i)=>{
  const matched=pairs(page,photo,layouts[i]);
  // Nested/overlapping text does not supply a second distinct whole field.
  const terms=[...new Set(matched.map(f=>f.text))].filter(t=>!matched.some(f=>f.text!==t&&f.text.includes(t)));
  const containing=terms.length?corpus.map((fields,j)=>terms.every(t=>fields.some(f=>f.includes(t)))?j:-1).filter(j=>j>=0):[];
  return {id:page.id,uniqueComposite:terms.length>=2&&containing.length===1&&containing[0]===i,
   fields:matched.filter(f=>terms.includes(f.text)).map(({text,...f})=>f)};
 });
 return {status:'positioned-composite-not-binding',rows,candidates:rows.filter(r=>r.uniqueComposite).length,mayAssignNumber:false};
}

// Text sources and all physical page IDs must match the exact live collector
// input, not a plausible JSON report or text borrowed from a different page.
export function positionedBodySupport({pages,views,index,photoSha256,positionedLayoutReview,read,expectedPrefix},target){
 const evidence=positionedLayoutEvidence(positionedLayoutReview);
 if(!evidence)return null;
 try{
  if(evidence.pages.length!==index.length||pages.length!==index.length
   ||new Set(index.map(id)).size!==index.length||new Set(pages.map(id)).size!==pages.length
   ||evidence.pages.some(p=>!index.some(q=>id(q)===p.id)))return null;
  const inputPhoto=evidence.photos.find(p=>p.id===photoSha256),layout=evidence.results.find(p=>p.id===photoSha256);
  if(!inputPhoto||!layout||inputPhoto.sourceSha256!==photoSha256||inputPhoto.viewsSha256!==digest(views))return null;
  const slim=v=>visualBodyViewNames.map(name=>{const {view,text,errors,truncated}=v.find(r=>r.view===name);return {view,text,errors,truncated};});
  for(const p of evidence.pages){
   const current=pages.find(q=>id(q)===p.id);
   if(!current||digest(current.fieldTexts)!==digest(p.fieldTexts)||digest(slim(current.visibleFieldViews))!==digest(slim(p.views))
    ||digest(current.supplementalText)!==digest(slim(p.views).map(v=>v.text)))return null;
  }
  const compared=comparePositionedFields(evidence.pages,inputPhoto,layout.pages),candidates=compared.rows.filter(r=>r.uniqueComposite);
  if(candidates.length!==1||candidates[0].id!==id(target))return null;
  if(!codeWithinProposal(read,`${expectedPrefix}-1-${target.number}`,inputPhoto,layout.pages.find(p=>p.id===id(target))))return null;
  return {policy:'observed-code-plus-positioned-current-body-v1',fields:candidates[0].fields,
   corpusSha256:digest(evidence.pages),photoViewsSha256:inputPhoto.viewsSha256,
   geometrySha256:digest(layout),requestHashes:[...positionedLayoutReview.requestHashes],
   runtimeManifestSha256:positionedLayoutReview.runtimeManifestSha256,
   geometrySourceSha256:positionedLayoutReview.geometrySourceSha256,
   codeWithinProposedInkEnvelope:true,physicalCodeExtentVerified:false,foregroundVerified:false,bindingVerified:false};
 }catch{return null;}
}
