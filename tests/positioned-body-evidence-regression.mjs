import assert from 'node:assert/strict';
import test from 'node:test';
import {comparePositionedFields,positionedBodySupport} from '../src/positioned-body-evidence.mjs';
import {visualBodyViewNames} from '../src/pdf-visual-body-evidence.mjs';
import {horizontalBodyCrop} from '../src/vertical-body-regions.mjs';
export const syntheticPositionedViews=(texts,{width=600,height=400,offsetX=0,offsetY=0,scale=1}={})=>visualBodyViewNames.map((view,i)=>{
 const fields=i<2?texts.map((text,j)=>{
  const region={left:(120*scale+offsetX)/width,top:((100+j*110)*scale+offsetY)/height,width:100*scale/width,height:28*scale/height,score:.99};
  return {text,regionIndex:j,region,confidence:.99,crop:horizontalBodyCrop(region,{width,height},i===0?.35:.65)};
 }):[];
 return {view,text:fields.map(f=>f.text).join('。'),errors:0,truncated:false,lineCount:fields.length,regions:fields.length,
  positioned:{schemaVersion:1,dimensions:{width,height},fields}};
});
export function positionedFixture(){
 const terms=[['松风亭','清净堂'],['松风亭','明月台']];
 const pages=terms.map((fieldTexts,i)=>({id:'b'.repeat(64)+':'+(i+1),shape:[400,600],fieldTexts,views:syntheticPositionedViews(fieldTexts)}));
 const photo={shape:[600,800],views:syntheticPositionedViews(terms[0],{width:800,height:600,offsetX:100,offsetY:100})};
 const layouts=pages.map(p=>({id:p.id,evidence:{candidate:true,localSupport:{observed:true,matrix:[[1,0,100],[0,1,100],[0,0,1]],
  sourceHull:[[0,0],[600,0],[600,400],[0,400]],projectedHull:[[100,100],[700,100],[700,500],[100,500]]}}}));
 return {pages,photo,layouts};
}
const compare=f=>comparePositionedFields(f.pages,f.photo,f.layouts);
test('paired positioned whole fields form a unique composite, not a number authority',()=>{
 const f=positionedFixture(),result=compare(f);
 assert.equal(result.candidates,1);assert.equal(result.rows[0].fields.length,2);assert.equal(result.mayAssignNumber,false);
 assert(result.rows[0].fields.every(f=>Math.abs(f.iou-1)<1e-10));
 assert.doesNotMatch(JSON.stringify(result),/松风|清净|明月/);
 assert.equal(positionedBodySupport({positionedLayoutReview:result}),null);
});
test('geometry uses reduced image shape, not original OCR dimensions',()=>{
 const f=positionedFixture();
 f.pages.forEach(p=>p.views=syntheticPositionedViews(p.fieldTexts,{width:1200,height:800,scale:2}));
 f.photo.views=syntheticPositionedViews(f.pages[0].fieldTexts,{width:1600,height:1200,offsetX:200,offsetY:200,scale:2});
 assert.equal(compare(f).candidates,1);
});
const rejected={
 'a common name alone':f=>f.photo.views=syntheticPositionedViews(['松风亭'],{width:800,height:600,offsetX:100,offsetY:100}),
 'same composite on another page':f=>{f.pages[1].fieldTexts=[...f.pages[0].fieldTexts];f.pages[1].views=structuredClone(f.pages[0].views);},
 'extracted PDF-only common fields':f=>f.pages[1].fieldTexts.push('清净堂'),
 'longer fields cannot hide the same name/phrase':f=>f.pages[1].fieldTexts.push('诚祝清净堂'),
 'multiline extraction cannot hide ambiguity':f=>f.pages[1].fieldTexts.push('其他文字\n清净堂'),
 'separate lines cannot be joined into a whole field':f=>{f.photo.views=syntheticPositionedViews(['松风\n亭','清净堂'],{width:800,height:600,offsetX:100,offsetY:100});},
 'opposite cropped view':f=>{f.photo.views[1].positioned.fields[1].text='明月台';f.photo.views[1].text='松风亭。明月台';},
 'body located on another background plane':f=>f.layouts[0].evidence.localSupport.matrix[0][2]=400,
 'outside source support':f=>f.layouts[0].evidence.localSupport.sourceHull=[[300,0],[600,0],[600,400],[300,400]],
 'outside observed photo support':f=>f.layouts[0].evidence.localSupport.projectedHull=[[400,100],[700,100],[700,500],[400,500]],
 'partial layout':f=>f.layouts[0].evidence.candidate=false,
 'no geometry fit':f=>f.layouts[0].evidence.localSupport.observed=false,
 'geometry at wrong scale':f=>f.layouts[0].evidence.localSupport.matrix=[[.5,0,100],[0,.5,100],[0,0,1]],
 'reflected page':f=>f.layouts[0].evidence.localSupport.matrix=[[-1,0,440],[0,1,100],[0,0,1]],
 'projective pole':f=>f.layouts[0].evidence.localSupport.matrix=[[1,0,100],[0,1,100],[0,0,0]],
};
for(const [label,change] of Object.entries(rejected))test(`positioned composite rejects ${label}`,()=>{const f=positionedFixture();change(f);assert.equal(compare(f).candidates,0);});
for(const [label,change] of Object.entries({
 'missing page':f=>f.layouts.pop(),
 'duplicate physical page':f=>{f.pages[1].id=f.pages[0].id;f.layouts[1].id=f.layouts[0].id;},
 'altered field crop':f=>f.photo.views[0].positioned.fields[0].crop.left++,
 'failed nonleading page':f=>f.pages[1].views[0].errors=1,
 'failed photo view':f=>f.photo.views[3].truncated=true,
 'nonfinite geometry':f=>f.layouts[0].evidence.localSupport.matrix[0][0]=NaN,
 'nonconvex support':f=>f.layouts[0].evidence.localSupport.sourceHull=[[0,0],[600,400],[600,0],[0,400]],
}))test(`positioned corpus fails closed: ${label}`,()=>{const f=positionedFixture();change(f);assert.throws(()=>compare(f));});
