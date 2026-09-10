// Experimental, read-only extraction. NOT called by the production planner.
// A PDF object is not proof of printed content: compare every native RGB pixel
// with the final physical page render before exposing its original bitmap.
import crypto from 'node:crypto';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {createCanvas,ImageData}=require('@napi-rs/canvas');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const identity=[1,0,0,1,0,0];
const multiply=(m,n)=>[
  m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],
  m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],
  m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5],
];
const close=(a,b)=>Math.abs(a-b)<1e-7;

function opaqueRgb(image,kind) {
  const {width,height,data}=image;
  if(!data)return null; // Unsupported decoded bitmap representations abstain.
  const size=width*height,out=Buffer.alloc(size*3);
  if(kind===2&&data.length===size*3)return Buffer.from(data);
  if(kind===3&&data.length===size*4) {
    for(let i=0;i<size;i++) {
      if(data[i*4+3]!==255)return null;
      out[i*3]=data[i*4];out[i*3+1]=data[i*4+1];out[i*3+2]=data[i*4+2];
    }
    return out;
  }
  if(kind===1&&data.length===Math.ceil(width/8)*height) {
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const value=(data[y*Math.ceil(width/8)+(x>>3)]&(128>>(x&7)))?255:0;
      out.fill(value,(y*width+x)*3,(y*width+x)*3+3);
    }
    return out;
  }
  return null;
}
function canvasRgb(ctx,x,y,width,height) {
  const rgba=ctx.getImageData(x,y,width,height).data,out=Buffer.alloc(width*height*3);
  for(let i=0;i<width*height;i++) {
    if(rgba[i*4+3]!==255)return null;
    out[i*3]=rgba[i*4];out[i*3+1]=rgba[i*4+1];out[i*3+2]=rgba[i*4+2];
  }
  return out;
}
function pngFromRgb(rgb,width,height) {
  const rgba=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++) {
    rgba[i*4]=rgb[i*3];rgba[i*4+1]=rgb[i*3+1];rgba[i*4+2]=rgb[i*3+2];rgba[i*4+3]=255;
  }
  const canvas=createCanvas(width,height);
  canvas.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);
  return canvas.toBuffer('image/png');
}

export async function extractVisiblePdfCodeImages(input,{onPage=null}={}) {
  if(!(input instanceof Uint8Array)||!input.length)throw Error('PDF bytes required');
  // pdf.js may transfer its input. Never detach or mutate the caller's bytes.
  const bytes=Uint8Array.from(input),pdfSha256=hash(bytes);
  const pdfjs=await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const standardFontDataUrl=path.join(path.dirname(require.resolve('pdfjs-dist/package.json')),'standard_fonts').replaceAll('\\','/')+'/';
  const document=await pdfjs.getDocument({data:bytes,disableWorker:true,standardFontDataUrl,useSystemFonts:false}).promise;
  const pages=[];
  try {
    for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++) {
      const page=await document.getPage(pageNumber);
      try {
        const viewport=page.getViewport({scale:1});
        if(viewport.width*viewport.height>20_000_000)throw Error('PDF page exceeds bounded diagnostic render');
        const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height)),ctx=canvas.getContext('2d');
        await page.render({canvasContext:ctx,viewport}).promise;
        const operators=await page.getOperatorList(),OPS=pdfjs.OPS;
        let matrix=identity.slice(),unsupportedContext=false;
        const stack=[],painted=[],rejected=[];
        const object=async id=>{
          const objects=String(id).startsWith('g_')?page.commonObjs:page.objs;
          if(objects.has(id))return objects.get(id);
          // Operator-list intent can decode separately from render intent.
          // Await its image dependency; never treat an unresolved cache as an
          // absent image or wait without a bound.
          return new Promise(resolve=>{
            const timer=setTimeout(()=>resolve(null),5000);
            objects.get(id,image=>{clearTimeout(timer);resolve(image);});
          });
        };
        const collect=(image,index,extra=null)=>{
          if(!image){rejected.push({reason:'unavailable-image-object',operatorIndex:index});return;}
          if(image.width!==100||image.height!==15)return;
          painted.push({image,index,matrix:multiply(viewport.transform,extra?multiply(matrix,extra):matrix)});
        };
        for(let i=0;i<operators.fnArray.length;i++) {
          const op=operators.fnArray[i],args=operators.argsArray[i];
          if(op===OPS.save)stack.push(matrix.slice());
          else if(op===OPS.restore) {if(!stack.length)throw Error('Unbalanced PDF graphics state');matrix=stack.pop();}
          else if(op===OPS.transform)matrix=multiply(matrix,args);
          else if(op===OPS.paintFormXObjectBegin) {stack.push(matrix.slice());if(args[0])matrix=multiply(matrix,args[0]);}
          else if(op===OPS.paintFormXObjectEnd) {if(!stack.length)throw Error('Unbalanced PDF form state');matrix=stack.pop();}
          else if(op===OPS.beginGroup||op===OPS.endGroup||op===OPS.beginAnnotation||op===OPS.endAnnotation)unsupportedContext=true;
          else if(op===OPS.paintImageXObject)collect(await object(args[0]),i);
          else if(op===OPS.paintInlineImageXObject)collect(args[0],i);
          else if(op===OPS.paintImageXObjectRepeat) {
            const [id,sx,sy,positions]=args,image=await object(id);
            for(let j=0;j<positions.length;j+=2)collect(image,i,[sx,0,0,sy,positions[j],positions[j+1]]);
          }
          else if(op===OPS.paintInlineImageXObjectGroup)unsupportedContext=true;
        }
        if(stack.length)throw Error('Unbalanced PDF graphics stack');
        const candidates=[],seen=new Map();
        for(const {image,index,matrix:m} of painted) {
          const reject=reason=>rejected.push({reason,operatorIndex:index});
          if(unsupportedContext){reject('unsupported-compositing-context');continue;}
          const {width,height}=image;
          if(!m.every(Number.isFinite)||!close(m[0],width)||!close(m[3],-height)||!close(m[1],0)||!close(m[2],0)
            ||!close(m[4],Math.round(m[4]))||!close(m[5],Math.round(m[5]))) {reject('not-upright-native-pixel-placement');continue;}
          const x=Math.round(m[4]),y=Math.round(m[5])-height;
          if(x<0||y<0||x+width>viewport.width||y+height>viewport.height){reject('outside-physical-page');continue;}
          const raw=opaqueRgb(image,image.kind);
          if(!raw){reject('unsupported-or-translucent-pixels');continue;}
          // Blank/background assets are not code candidates, even if visible.
          let ink=0;for(let n=0;n<raw.length;n+=3)if(Math.max(raw[n],raw[n+1],raw[n+2])<180)ink++;
          if(ink<8){reject('insufficient-visible-ink');continue;}
          const finalPixels=canvasRgb(ctx,x,y,width,height);
          if(!finalPixels||!raw.equals(finalPixels)){reject('final-page-pixels-differ');continue;}
          const rawPixelSha256=hash(raw),bounds={x,y,width,height};
          const key=JSON.stringify([pdfSha256,pageNumber,bounds,rawPixelSha256]);
          if(seen.has(key)){seen.get(key).duplicatePaintCount++;continue;}
          const png=pngFromRgb(raw,width,height);
          const candidate={identity:hash(key),pdfSha256,pageNumber,bounds,width,height,rawPixelSha256,
            pagePixelSha256:hash(finalPixels),pngSha256:hash(png),png,duplicatePaintCount:1,
            visiblePixelComparison:'exact',orderBindingVerified:false,mayAuthorizeUpload:false};
          seen.set(key,candidate);candidates.push(candidate);
        }
        const result={pdfSha256,pageNumber,candidates,rejected};pages.push(result);
        await onPage?.(result);
      } finally {page.cleanup();}
    }
  } finally {await document.destroy();}
  if(hash(input)!==pdfSha256)throw Error('Caller PDF bytes changed during extraction');
  return {schemaVersion:1,pdfSha256,pages,orderBindingVerified:false,releaseAccepted:false};
}
