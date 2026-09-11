// Diagnostic correspondences only. Text identity alone cannot prove that a
// field was at the same place, occurred only once, or belongs to an order.
// No production imports, page assignment, code-conflict clearing or networking.
import crypto from 'node:crypto';
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
const normalize=text=>text.normalize('NFKC').replace(/[^\S\r\n]/gu,'');
const term=text=>typeof text==='string'&&/^\p{Script=Han}{2,40}$/u.test(normalize(text))?normalize(text):null;
const center=r=>[r.x,r.y];
const validPosition=r=>r&&Number.isFinite(r.x)&&Number.isFinite(r.y)&&r.x>=0&&r.x<=1&&r.y>=0&&r.y<=1;
const id=p=>p.pdfSha256+':'+p.pageNumber;

// PDF text axes and page rotation are separate transforms. Width/height are
// measured along those text axes, not necessarily PDF x/y. This is the center
// of the text-item advance box, not a claimed exact glyph/paper boundary.
export function pdfTextItemCenter(item,viewport){
  const t=item?.transform,v=viewport?.transform;
  if(!Array.isArray(t)||t.length!==6||!Array.isArray(v)||v.length!==6||[...t,...v].some(x=>!Number.isFinite(x))
    ||![item.width,item.height,viewport.width,viewport.height].every(x=>Number.isFinite(x)&&x>0))return null;
  const tx=Math.hypot(t[0],t[1]),ty=Math.hypot(t[2],t[3]);
  if(tx<1e-8||ty<1e-8||Math.abs(t[0]*t[3]-t[1]*t[2])<1e-8||Math.abs(v[0]*v[3]-v[1]*v[2])<1e-8)return null;
  const px=t[4]+t[0]/tx*item.width/2+t[2]/ty*item.height/2;
  const py=t[5]+t[1]/tx*item.width/2+t[3]/ty*item.height/2;
  const result={x:(v[0]*px+v[2]*py+v[4])/viewport.width,y:(v[1]*px+v[3]*py+v[5])/viewport.height};
  return validPosition(result)?result:null;
}

export function spatialBodyCorrespondences(pages,views){
  if(!Array.isArray(pages)||!pages.length||pages.some(p=>!/^([a-f0-9]{64})$/.test(p?.pdfSha256||'')
    ||!Number.isInteger(p.pageNumber)||p.pageNumber<1||!Array.isArray(p.fields)
    ||p.fields.some(f=>!validPosition(f)||typeof f.text!=='string')))throw Error('Invalid positioned PDF fields');
  if(new Set(pages.map(id)).size!==pages.length)throw Error('Duplicate physical page');
  const names=['chinese-detected-0.35','chinese-detected-0.65'];
  if(!Array.isArray(views)||views.length!==2||names.some(name=>views.filter(v=>v?.view===name).length!==1))throw Error('Incomplete paired horizontal observations');
  const ordered=names.map(name=>views.find(v=>v.view===name));
  for(const view of ordered)if(view.errors!==0||view.truncated!==false||!Array.isArray(view.fields)
    ||view.fields.some(f=>!validPosition(f)||typeof f.text!=='string'||!Number.isInteger(f.regionIndex)||f.regionIndex<0)
    ||new Set(view.fields.map(f=>f.regionIndex)).size!==view.fields.length)throw Error('Invalid positioned photo observations');
  const second=new Map(ordered[1].fields.map(f=>[f.regionIndex,f]));
  const paired=ordered[0].fields.filter(f=>{
    const next=second.get(f.regionIndex);return term(f.text)&&next&&term(f.text)===term(next.text)&&f.x===next.x&&f.y===next.y;
  });
  const observed=paired.filter(f=>paired.filter(g=>term(f.text)===term(g.text)).length===1);
  // A substring on ANY other PDF field is ambiguous. Never turn concatenated
  // glyphs or duplicate occurrences into independent spatial support.
  return pages.map(page=>{
    const pairs=page.fields.flatMap(field=>{
      const text=term(field.text);if(!text)return [];
      if(page.fields.filter(f=>term(f.text)===text).length!==1)return [];
      if(pages.some(p=>id(p)!==id(page)&&p.fields.some(f=>normalize(f.text).includes(text))))return [];
      const found=observed.filter(f=>term(f.text)===text);if(found.length!==1)return [];
      return [{fieldSha256:sha(text),pdfPoint:center(field),photoPoint:center(found[0]),regionIndex:found[0].regionIndex}];
    });
    return {pdfSha256:page.pdfSha256,pageNumber:page.pageNumber,pairs,
      status:'spatial-observation-not-binding',mayAssign:false,mayClearCodeConflict:false};
  });
}
