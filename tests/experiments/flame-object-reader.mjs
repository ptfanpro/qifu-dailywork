// Experimental pixel observations, NOT a scene classifier or upload authority.
// Original aspect ratio; no dates, paper numbers, labels, or PDF inputs.
// Bright warm connected components must be upright, locally contrasted, and
// have a dark base. These are only flame-like proposals: metal reflections,
// lamps behind a sheet, and mixed water/lamp scenes remain counterexamples.
export const FLAME_OBJECT_RECIPE = 'upright-bright-dark-base-v1';

export function observeFlameObjects(data, width, height, channels = 3) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16
    || width > 1600 || height > 1600 || ![3,4].includes(channels)
    || !(data instanceof Uint8Array) || data.length !== width * height * channels) {
    throw Error('Invalid bounded RGB observation');
  }
  const count = width * height, mask = new Uint8Array(count), seen = new Uint8Array(count);
  const queue = new Int32Array(count), objects = [];
  const lum = i => .2126 * data[i*channels] + .7152 * data[i*channels+1] + .0722 * data[i*channels+2];
  for (let i=0;i<count;i++) {
    const r=data[i*channels],g=data[i*channels+1],b=data[i*channels+2];
    mask[i]=Number(r>=225 && g>=205 && b>=145 && r>=g*.95 && g>=b*.95);
  }
  for (let seed=0;seed<count;seed++) {
    if (!mask[seed] || seen[seed]) continue;
    let head=0,tail=1,left=width,right=0,top=height,bottom=0,sx=0,sy=0,brightness=0;
    queue[0]=seed;seen[seed]=1;
    while (head<tail) {
      const i=queue[head++],x=i%width,y=Math.floor(i/width);
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      sx+=x;sy+=y;brightness+=lum(i);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const nx=x+dx,ny=y+dy,ni=ny*width+nx;
        if(nx>=0&&nx<width&&ny>=0&&ny<height&&!seen[ni]&&mask[ni]){seen[ni]=1;queue[tail++]=ni;}
      }
    }
    const w=right-left+1,h=bottom-top+1;
    if(tail<3 || h<3 || h/w<1.25 || h>height*.10 || w>width*.035
      || left===0 || right===width-1 || top===0 || bottom>=height-3)continue;
    const cx=Math.round(sx/tail),gap=Math.max(2,w),ys=top+Math.floor(h*.25),ye=top+Math.ceil(h*.75);
    let sides=0,sideCount=0;
    for(let y=ys;y<=ye;y++)for(const x of [left-gap,right+gap])if(x>=0&&x<width){sides+=lum(y*width+x);sideCount++;}
    if(!sideCount)continue;
    const contrast=brightness/tail-sides/sideCount;
    let baseMinimum=255;
    for(let y=bottom+1;y<=Math.min(height-1,bottom+Math.max(3,Math.round(h*.6)));y++) {
      for(let x=Math.max(0,cx-Math.max(1,Math.round(w*.25)));x<=Math.min(width-1,cx+Math.max(1,Math.round(w*.25)));x++)baseMinimum=Math.min(baseMinimum,lum(y*width+x));
    }
    if(contrast<45 || baseMinimum>130)continue;
    objects.push({box:{left,top,width:w,height:h},area:tail,
      center:{x:sx/tail/width,y:sy/tail/height},contrast,baseMinimum});
  }
  const lower=objects.filter(o=>o.center.y>=.35),xs=lower.map(o=>o.center.x),ys=lower.map(o=>o.center.y);
  return {schemaVersion:1,recipe:FLAME_OBJECT_RECIPE,width,height,objects,
    lowerCount:lower.length,columns:new Set(xs.map(x=>Math.floor(x*5))).size,
    rows:new Set(ys.map(y=>Math.floor(y*8))).size,
    spanX:xs.length?Math.max(...xs)-Math.min(...xs):0,
    spanY:ys.length?Math.max(...ys)-Math.min(...ys):0,
    sceneRole:null,foregroundVerified:false,mayClearCodeConflict:false,mayAuthorizeUpload:false};
}
