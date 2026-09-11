// Rejected diagnostic experiment, not a production OCR path. Rotating an entire
// vertical line also rotates each glyph, which is not horizontal CJK writing.
// This helper has no text/number/PDF inputs and never grants a page binding.
// Actual paired PDF/photo A/B showed no additional discriminating fields;
// do not reintroduce it as an accuracy fix without new held-out evidence.
export const UPRIGHT_VERTICAL_RECIPE='upright-row-groups-v1';
export function uprightVerticalLine(data,width,height) {
  if(arguments.length!==3||!(data instanceof Uint8Array)||!Number.isInteger(width)||!Number.isInteger(height)
    ||width<1||height<1||width>1024||height>4096||data.length!==width*height)
    throw Error('Bounded grayscale vertical pixels required');
  const base={recipe:UPRIGHT_VERTICAL_RECIPE,rotation:0,order:'top-to-bottom',segments:[],
    mayAssignNumber:false,mayClearConflict:false};
  const reject=status=>({...base,status});
  if(height<2.5*width)return reject('not-vertical');
  const hist=new Uint32Array(256);let sum=0;
  for(const v of data){hist[v]++;sum+=v;}
  let leftN=0,leftSum=0,best=-1,cut=0;
  for(let t=0;t<255;t++) {
    leftN+=hist[t];leftSum+=t*hist[t];const rightN=data.length-leftN;
    if(!leftN||!rightN)continue;
    const d=leftSum/leftN-(sum-leftSum)/rightN,score=leftN*rightN*d*d;
    if(score>best){best=score;cut=t;}
  }
  if(best<0)return reject(data[0]<128?'foreground-not-isolated':'blank');
  const rows=new Uint32Array(height);let left=width,right=-1,ink=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[y*width+x]<=cut){
    rows[y]++;left=Math.min(left,x);right=Math.max(right,x);ink++;
  }
  if(!ink)return reject('blank');
  if(ink/data.length>.6)return reject('foreground-not-isolated');
  const inkWidth=right-left+1,runs=[];
  for(let y=0;y<height;) {
    if(!rows[y]){y++;continue;}
    const top=y;while(y<height&&rows[y])y++;
    const previous=runs.at(-1);
    // Merge only short within-glyph gaps; do not discard marks, infer a
    // character count, or pick a subset to resemble an expected answer.
    if(previous&&top-previous.bottom<=Math.max(1,Math.floor(inkWidth*.18)))previous.bottom=y;
    else runs.push({top,bottom:y});
  }
  if(runs.length<2||runs.length>40)return reject('unsupported-segmentation');
  if(runs.some(r=>r.bottom-r.top<inkWidth*.35||r.bottom-r.top>inkWidth*1.8))
    return reject('unsupported-glyph-shape');
  const outHeight=Math.max(...runs.map(r=>r.bottom-r.top))+4;
  const outWidth=4+runs.length*inkWidth+(runs.length-1)*4;
  if(outWidth>4096)return reject('line-too-wide');
  const pixels=new Uint8Array(outWidth*outHeight).fill(255),segments=[];
  for(const [i,r] of runs.entries()) {
    const glyphHeight=r.bottom-r.top,outputLeft=2+i*(inkWidth+4),outputTop=Math.floor((outHeight-glyphHeight)/2);
    for(let y=0;y<glyphHeight;y++)pixels.set(data.subarray((r.top+y)*width+left,(r.top+y)*width+right+1),
      (outputTop+y)*outWidth+outputLeft);
    segments.push({left,top:r.top,width:inkWidth,height:glyphHeight,outputLeft,outputTop});
  }
  return {...base,status:'ready',threshold:cut,width:outWidth,height:outHeight,pixels,segments};
}
