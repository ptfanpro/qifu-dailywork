import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readDetectedBodyViews} from '../src/chinese-body-reader.mjs';
import {horizontalBodyCrop,verticalBodyCrop} from '../src/vertical-body-regions.mjs';
const sharp=createRequire(import.meta.url)('sharp');
const original=await sharp({create:{width:240,height:180,channels:3,background:'#b08d60'}}).raw().toBuffer({resolveWithObject:true});
const regions=[
  {left:.1,top:.1,width:.3,height:.05,score:.9},
  {left:.7,top:.1,width:.1,height:.15,score:.8}, // neither eligible layout
  {left:.4,top:.3,width:.04,height:.5,score:.9},
  {left:.1,top:.85,width:.3,height:.04,score:.9},
];
const reads=[];
const readLine=async bytes=>{reads.push(bytes);return {text:'春山秋水',confidence:.95};};
const plain=await readDetectedBodyViews(original,regions,readLine,{includeVertical:true});
const located=await readDetectedBodyViews(original,regions,readLine,{includeVertical:true,includePositions:true});
assert.deepEqual(located.map(({positioned,...view})=>view),plain);
assert.ok(plain.every(v=>!Object.hasOwn(v,'positioned')));
assert.deepEqual(reads.slice(0,6),reads.slice(6));
for(let i=0;i<located.length;i++){
 const view=located[i],vertical=i>=2,padding=i%2===0?.35:.65;
 assert.deepEqual(view.positioned.dimensions,{width:240,height:180});
 assert.equal(view.positioned.schemaVersion,1);
 assert.deepEqual(view.positioned.fields.map(f=>f.regionIndex),vertical?[2]:[0,3]);
 assert.equal(view.text,view.positioned.fields.map(f=>f.text).join('。'));
 for(const f of view.positioned.fields){
  assert.deepEqual(f.region,regions[f.regionIndex]);
  assert.deepEqual(f.crop,(vertical?verticalBodyCrop:horizontalBodyCrop)(f.region,original.info,padding));
  assert.equal(f.confidence,.95);
 }
}
regions[0].left=.15;
assert.equal(located[0].positioned.fields[0].region.left,.1,'output cannot alias a mutable detector region');
let count=0;
const partial=await readDetectedBodyViews(original,regions,async()=>{
 count++;if(count===1)throw Error('synthetic reader failure');return {text:'不应采纳',confidence:.64};
},{includeVertical:true,includePositions:true});
assert.equal(partial[0].errors,1);
assert.ok(partial.every(v=>v.lineCount===0&&v.positioned.fields.length===0&&v.text===''));
// A repeated field remains two spatial occurrences, not one fabricated name.
assert.equal(located[0].positioned.fields.length,2);
assert.equal(located[0].positioned.fields[0].text,located[0].positioned.fields[1].text);
const empty=await readDetectedBodyViews(original,[],readLine,{includePositions:true});
assert.equal(empty.length,2);assert.ok(empty.every(v=>v.regions===0&&!v.truncated&&v.positioned.fields.length===0));
const verticals=Array.from({length:81},()=>({left:.4,top:.3,width:.04,height:.5,score:.9}));
let cappedReads=0;
const capped=await readDetectedBodyViews(original,verticals,async()=>{cappedReads++;return {text:'春山',confidence:.9};},{includeVertical:true,includePositions:true});
assert.equal(cappedReads,160);
assert.ok(capped.slice(2).every(v=>v.truncated&&v.regions===81&&v.positioned.fields.length===80));
assert.equal(capped[2].positioned.fields.at(-1).regionIndex,79);
console.log('Positioned body reader regression passed: crop identity, multiplicity, legacy output, failures and caps');
