import assert from 'node:assert/strict';
import {screenWholeBodyConjunction} from '../../src/whole-body-conjunction.mjs';
import {visualBodyViewNames,buildVisualBodyPages} from '../../src/pdf-visual-body-evidence.mjs';
import {horizontalBodyCrop} from '../../src/vertical-body-regions.mjs';
const names=Object.freeze(['松柏青','海月明','竹风远']),other=Object.freeze(['清风堂','白云台','明镜阁']);
const pdfSha256='b'.repeat(64);
export function views(terms=names){
 const dimensions={width:1000,height:800};
 return visualBodyViewNames.map((view,i)=>{
  const fields=i<2?terms.map((text,j)=>{
   const region={left:.1+(j%2)*.5,top:.2+Math.floor(j/2)*.25,width:.12,height:.025,score:.99};
   return {text,regionIndex:j,region,confidence:.99,crop:horizontalBodyCrop(region,dimensions,i===0?.35:.65)};
  }):[];
  return {view,text:fields.map(f=>f.text).join('。'),errors:0,truncated:false,lineCount:fields.length,regions:fields.length,
   positioned:{schemaVersion:1,dimensions,fields}};
 });
}
export function input(terms=names){
 const fields=[terms,other];
 const pages=buildVisualBodyPages(fields.map((f,i)=>({pdfSha256,pageNumber:i+1,fieldTexts:[...f]})),
  fields.map((f,i)=>({pdfSha256,pageNumber:i+1,views:views(f)})));
 return {views:views(terms),pages,index:[{pdfSha256,pageNumber:1,number:7},{pdfSha256,pageNumber:2,number:8}]};
}
for(const terms of [names,['松柏清境',...names.slice(1)]]){
 const x=input(terms),before=JSON.stringify(x),r=screenWholeBodyConjunction(x);
 assert.equal(r.status,'single-page-conjunction');assert.equal(r.candidate.target.number,7);
 assert.equal(r.candidate.support[0].fieldHashes.length,3);
 assert.equal(r.mayAssignNumber,false);assert.equal(r.mayClearCodeConflict,false);
 assert.equal(JSON.stringify(x),before);assert.doesNotMatch(JSON.stringify(r),/松柏|海月|竹风/);
}
let negatives=0;
function reject(label,mutate){
 const x=input();assert.equal(screenWholeBodyConjunction(x).status,'single-page-conjunction',`${label}: fresh positive baseline`);
 mutate(x);const before=JSON.stringify(x),r=screenWholeBodyConjunction(x);
 assert.notEqual(r.status,'single-page-conjunction',label);assert.equal(r.candidate,null,label);
 assert.equal(r.mayAssignNumber,false);assert.equal(r.mayClearCodeConflict,false);assert.equal(JSON.stringify(x),before);negatives++;
}
reject('two fields',x=>x.views=views(names.slice(0,2)));
reject('repeated field',x=>x.views=views([names[0],names[0],names[0]]));
reject('missing source positions',x=>x.views.forEach(v=>delete v.positioned));
reject('multiline assembly',x=>x.views=views(['松柏\n青',...names.slice(1)]));
reject('one-view field cannot be pooled',x=>x.views[1]=views(names.slice(0,2))[1]);
reject('changed actual crop',x=>x.views[0].positioned.fields[0].crop.left++);
reject('overlap',x=>{
 for(const [i,v] of x.views.slice(0,2).entries())for(const [j,f] of v.positioned.fields.entries()){
  f.region.left=.1+j*.12;f.region.top=.2;f.crop=horizontalBodyCrop(f.region,v.positioned.dimensions,i===0?.35:.65);
 }
});
reject('duplicate detector occurrence',x=>x.views=views([names[0],...names]));
reject('missing PDF extraction',x=>x.pages[0].fieldTexts.pop());
reject('fragmented PDF extraction',x=>x.pages[0].fieldTexts.splice(0,1,...names[0]));
reject('missing paired visible PDF field',x=>{x.pages[0].visibleFieldViews[1].text=names.slice(0,2).join('。');x.pages[0].supplementalText[1]=x.pages[0].visibleFieldViews[1].text;});
reject('duplicate current PDF body',x=>x.pages[1]={...structuredClone(x.pages[0]),pageNumber:2});
reject('term inside another page',x=>x.pages[1].fieldTexts.push('敬祝'+names[0]));
reject('contrary body',x=>x.views=views([...names,other[0]]));
reject('one-view contrary body',x=>x.views[1]=views([...names,other[0]])[1]);
reject('failed body observation',x=>x.views[3].errors=1);
reject('truncated body observation',x=>x.views[0].truncated=true);
reject('partial corpus',x=>x.pages.pop());
reject('duplicate PDF identity',x=>x.index[1].pageNumber=1);
reject('duplicate number mapping',x=>x.index[1].number=7);
reject('malformed PDF hash',x=>x.pages[0].pdfSha256='invalid');
reject('foreign PDF page',x=>x.pages[1].pdfSha256='c'.repeat(64));
console.log(`Whole-body conjunction screen: 2 positives / ${negatives} negatives PASS; no assignment authority`);
