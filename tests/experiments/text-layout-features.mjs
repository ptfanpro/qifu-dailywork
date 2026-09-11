// Offline spatial descriptor, not a paper detector or business decision.
// Uses all valid regions from the frozen production text detector. No OCR
// strings, labels, PDF answers, business dates or filenames enter this module.
const LEVELS=[1,2,4,8],VIEWS=['center-crop','full-frame'];
const logCount=n=>Math.log1p(n)/Math.log(1001);
function unit(values,dimensions){
 if(!Array.isArray(values)||values.length!==dimensions||!values.every(Number.isFinite))throw Error('Invalid descriptor');
 const norm=Math.hypot(...values);if(norm<1e-8)throw Error('Empty descriptor');
 return values.map(v=>v/norm);
}

export function textLayoutDescriptor(regions,dimensions){
 const {width,height}=dimensions||{};
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)throw Error('Invalid image dimensions');
 if(!Array.isArray(regions)||regions.length>=1000)throw Error('Invalid or saturated text detection');
 const boxes=regions.map(r=>{
  if(!r||!['left','top','width','height','score'].every(k=>Number.isFinite(r[k]))
   ||r.left<0||r.top<0||r.width<=0||r.height<=0||r.left+r.width>1+1e-12||r.top+r.height>1+1e-12
   ||r.score<0||r.score>1)throw Error('Invalid normalized text region');
  return {left:r.left,top:r.top,width:r.width,height:r.height,score:r.score};
 }).sort((a,b)=>a.top-b.top||a.left-b.left||a.width-b.width||a.height-b.height||a.score-b.score);
 const raw=[1,logCount(boxes.length)];
 for(const level of LEVELS)for(let y=0;y<level;y++)for(let x=0;x<level;x++){
  const l=x/level,t=y/level,r=(x+1)/level,b=(y+1)/level;
  let count=0,area=0,widthSum=0,heightSum=0,horizontal=0,vertical=0;
  for(const box of boxes){
   area+=Math.max(0,Math.min(r,box.left+box.width)-Math.max(l,box.left))
    *Math.max(0,Math.min(b,box.top+box.height)-Math.max(t,box.top))*level*level;
   const cx=box.left+box.width/2,cy=box.top+box.height/2;
   if(cx>=l&&cx<r&&cy>=t&&cy<b){
    count++;widthSum+=box.width;heightSum+=box.height;
    const aspect=box.width*width/(box.height*height);
    if(aspect>=2)horizontal++;if(aspect<=.5)vertical++;
   }
  }
  // Regions are proposals and may overlap; capped area is not an ink ratio.
  raw.push(logCount(count),Math.min(1,area),count?widthSum/count:0,count?heightSum/count:0,logCount(horizontal),logCount(vertical));
 }
 return {version:'text-layout-pyramid-v1',regions:boxes.length,raw,embedding:unit(raw,512),
  roleVerified:false,bindingVerified:false,mayAuthorizeUpload:false};
}

export function joinTextLayoutViews(baseViews,layout){
 if(!Array.isArray(baseViews)||baseViews.length!==2||new Set(baseViews.map(v=>v.view)).size!==2
  ||baseViews.some(v=>!VIEWS.includes(v.view)))throw Error('Both frozen visual views required');
 const spatial=unit(layout?.embedding,512);
 return VIEWS.map(view=>({view,embedding:unit([
  ...unit(baseViews.find(v=>v.view===view).embedding,512),...spatial,
 ],1024)}));
}
