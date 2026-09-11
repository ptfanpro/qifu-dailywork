import assert from 'node:assert/strict';
import test from 'node:test';
import {textLayoutDescriptor,joinTextLayoutViews} from './text-layout-features.mjs';

const dimensions={width:1600,height:1200};
const box=(left,top,width=.2,height=.02)=>({left,top,width,height,score:.9});
const vector=n=>Array.from({length:512},(_,i)=>i===n?1:0);
const views=()=>['center-crop','full-frame'].map((view,i)=>({view,embedding:vector(i)}));

test('new visual encoder dimension is explicit and cannot silently enter the old CLIP contract',()=>{
 const visual=views().map(v=>({...v,embedding:[...v.embedding,...Array(256).fill(0)]}));
 const layout=textLayoutDescriptor([box(.3,.4)],dimensions);
 assert.throws(()=>joinTextLayoutViews(visual,layout));
 const joined=joinTextLayoutViews(visual,layout,{visualDimensions:768});
 assert.equal(joined[0].embedding.length,1280);
 assert.deepEqual(joined[0].embedding.slice(768),joined[1].embedding.slice(768));
 assert(Math.abs(Math.hypot(...joined[0].embedding)-1)<1e-12);
 for(const n of [0,1,512.5,Infinity,4096])assert.throws(()=>joinTextLayoutViews(visual,layout,{visualDimensions:n}));
 assert.throws(()=>joinTextLayoutViews(views(),layout,{visualDimensions:768}));
});

test('layout is deterministic and order invariant; source dimensions, not dates or names, determine aspect',()=>{
 const a=[box(.2,.3),box(.5,.6),box(.2,.4)],before=structuredClone(a);
 const first=textLayoutDescriptor(a,dimensions);
 assert.deepEqual(first,textLayoutDescriptor([...a].reverse(),dimensions));
 assert.deepEqual(a,before);assert.equal(first.embedding.length,512);
 assert(Math.abs(Math.hypot(...first.embedding)-1)<1e-12);
 assert.deepEqual(first,textLayoutDescriptor(a,{width:3200,height:2400}));
 assert.equal(first.roleVerified,false);assert.equal(first.mayAuthorizeUpload,false);
});

test('body rows and an equal number of background banner boxes preserve different spatial descriptors',()=>{
 const rows=Array.from({length:12},(_,i)=>box(.3+(i%2)*.2,.35+Math.floor(i/2)*.04,.15));
 const banner=Array.from({length:12},(_,i)=>box(.04+i*.075,.03,.06,.07));
 const a=textLayoutDescriptor(rows,dimensions),b=textLayoutDescriptor(banner,dimensions);
 assert.notDeepEqual(a.embedding,b.embedding);
 assert.equal(a.regions,12);assert.equal(b.regions,12);
 // This feature distinction deliberately does not assert either image's role.
 assert.equal(a.roleVerified,false);assert.equal(b.roleVerified,false);
});

test('empty successful detector output is a valid observation, never scene proof; saturation and invalid input fail',()=>{
 const empty=textLayoutDescriptor([],dimensions);assert.equal(empty.regions,0);
 assert(empty.embedding.every(Number.isFinite));assert.equal(empty.roleVerified,false);
 for(const bad of [[box(-.1,.2)],[box(.9,.2,.2)],[box(.2,.2,0)],[{...box(.1,.1),score:NaN}],
   [{...box(.1,.1),score:1.01}],Array(1000).fill(box(.1,.1))])assert.throws(()=>textLayoutDescriptor(bad,dimensions));
 for(const size of [{width:0,height:20},{width:Infinity,height:100},{width:200,height:12.5}])
  assert.throws(()=>textLayoutDescriptor([],size));
});

test('boxes crossing grid boundaries contribute area to every intersected cell without discarding edges',()=>{
 const d=textLayoutDescriptor([box(.45,.45,.1,.1)],{width:1000,height:1000});
 // Raw level 2 cells follow the two globals and level 1's six features.
 const cells=Array.from({length:4},(_,i)=>d.raw[2+6+i*6+1]);
 for(const area of cells)assert(Math.abs(area-.01)<1e-12);
 assert(Math.abs(d.raw[2+1]-.01)<1e-12);
 assert(textLayoutDescriptor([box(0,0,1,1)],dimensions).embedding.every(Number.isFinite));
});

test('joining retains both CLIP views and a shared, explicitly correlated layout block',()=>{
 const base=views(),layout=textLayoutDescriptor([box(.3,.4)],dimensions);
 const out=joinTextLayoutViews(base,layout);
 assert.equal(out.length,2);assert.equal(out[0].embedding.length,1024);
 assert.deepEqual(out[0].embedding.slice(512),out[1].embedding.slice(512));
 assert.notDeepEqual(out[0].embedding.slice(0,512),out[1].embedding.slice(0,512));
 assert(Math.abs(Math.hypot(...out[0].embedding)-1)<1e-12);
 assert.deepEqual(base,views());
 assert.throws(()=>joinTextLayoutViews([base[0],base[0]],layout));
 assert.throws(()=>joinTextLayoutViews(base,{...layout,embedding:[1]}));
 assert.throws(()=>joinTextLayoutViews(base,{...layout,embedding:Array(512).fill(0)}));
 assert.throws(()=>joinTextLayoutViews(base,{...layout,embedding:Array(512).fill(NaN)}));
});
