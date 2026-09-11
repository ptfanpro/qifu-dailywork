import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const sharp=createRequire(import.meta.url)('sharp');
export const SEMANTIC_PIXEL_RECIPE='rgb-icc-ignored-exif-white-alpha-triangle-v2-two-224-views';

// Separable, antialiased triangle resampling. Positive 22-bit coefficients and
// byte rounding at each axis make this recipe explicit across libvips versions.
// It must be validated against the frozen training preprocessing, not assumed
// interchangeable merely because both are called "bilinear".
function coefficients(input,output){
  const scale=input/output,support=Math.max(1,scale),unit=1<<22;
  return Array.from({length:output},(_,i)=>{
    const center=(i+.5)*scale;
    const start=Math.max(0,Math.floor(center-support+.5));
    const end=Math.min(input,Math.floor(center+support+.5));
    const values=Array.from({length:end-start},(_,j)=>Math.max(0,1-Math.abs((start+j+.5-center)/support)));
    const sum=values.reduce((a,b)=>a+b,0);
    return {start,values:values.map(v=>Math.floor(v/sum*unit+.5))};
  });
}
export function resizeRgbBilinear(data,width,height,outWidth=224,outHeight=224){
  if(![width,height,outWidth,outHeight].every(v=>Number.isInteger(v)&&v>0&&v<=32768)
    ||width*height>30_000_000||outWidth*outHeight>30_000_000||data?.length!==width*height*3)
    throw Error('Invalid bounded RGB geometry');
  const cx=coefficients(width,outWidth),cy=coefficients(height,outHeight),unit=1<<22;
  const tmp=Buffer.alloc(outWidth*height*3),out=Buffer.alloc(outWidth*outHeight*3);
  for(let y=0;y<height;y++)for(let x=0;x<outWidth;x++)for(let c=0;c<3;c++){
    const k=cx[x];let sum=unit/2;
    for(let i=0;i<k.values.length;i++)sum+=data[(y*width+k.start+i)*3+c]*k.values[i];
    tmp[(y*outWidth+x)*3+c]=Math.min(255,Math.max(0,Math.floor(sum/unit)));
  }
  for(let y=0;y<outHeight;y++)for(let x=0;x<outWidth;x++)for(let c=0;c<3;c++){
    const k=cy[y];let sum=unit/2;
    for(let i=0;i<k.values.length;i++)sum+=tmp[((k.start+i)*outWidth+x)*3+c]*k.values[i];
    out[(y*outWidth+x)*3+c]=Math.min(255,Math.max(0,Math.floor(sum/unit)));
  }
  return out;
}
export async function prepareSemanticPixels(source){
  if(!Buffer.isBuffer(source)||!source.length||source.length>64*1024*1024)throw Error('Bounded image bytes required');
  // Own the input before the asynchronous decoder runs; caller mutation cannot
  // make the digest refer to different bytes than those actually decoded.
  const bytes=Buffer.from(source),inputSha256=crypto.createHash('sha256').update(bytes).digest('hex');
  // Training used Pillow convert('RGB'), not ImageCms.profileToProfile. Sharp
  // otherwise applies embedded ICC transforms implicitly, changing the model's
  // pixels even when both APIs report "RGB". Match that established recipe.
  const {data,info}=await sharp(bytes,{limitInputPixels:30_000_000,failOn:'error',ignoreIcc:true})
    .rotate().flatten({background:'#ffffff'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  if(info.channels!==3)throw Error('RGB decoding required');
  const {width,height}=info,side=Math.min(width,height),left=Math.floor((width-side)/2),top=Math.floor((height-side)/2);
  const square=Buffer.alloc(side*side*3);
  for(let y=0;y<side;y++)data.copy(square,y*side*3,((top+y)*width+left)*3,((top+y)*width+left+side)*3);
  const views=[resizeRgbBilinear(square,side,side),resizeRgbBilinear(data,width,height)];
  const pixels=new Float32Array(2*3*224*224);
  for(let v=0;v<2;v++)for(let p=0;p<224*224;p++)for(let c=0;c<3;c++)
    pixels[v*3*224*224+c*224*224+p]=Math.fround((Math.fround(views[v][p*3+c]/255)-.5)/.5);
  return {pixels,inputSha256,dimensions:{width,height},recipe:SEMANTIC_PIXEL_RECIPE};
}
