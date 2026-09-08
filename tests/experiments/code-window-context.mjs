// Diagnostic-only geometry: a detector box is a proposal, not proof of every glyph.
import {createRequire} from 'node:module';
const sharp=createRequire(import.meta.url)('sharp');

function validWindow(image,window) {
  if(!Number.isSafeInteger(image?.width)||image.width<1||!Number.isSafeInteger(image?.height)||image.height<1)
    throw Error('Invalid source dimensions');
  if(['left','top','width','height'].some(k=>!Number.isSafeInteger(window?.[k]))
    ||window.left<0||window.top<0||window.width<1||window.height<1
    ||window.left+window.width>image.width||window.top+window.height>image.height)
    throw Error('Window outside source');
}
export function codeWindowContext(image,window,{horizontalScale=2,verticalScale=4}={}) {
  validWindow(image,window);
  for(const scale of [horizontalScale,verticalScale])
    if(!Number.isFinite(scale)||scale<1||scale>4)throw Error('Invalid context scale');
  const x=window.width*(horizontalScale-1)/2,y=window.height*(verticalScale-1)/2;
  const left=Math.max(0,Math.floor(window.left-x)),top=Math.max(0,Math.floor(window.top-y));
  const right=Math.min(image.width,Math.ceil(window.left+window.width+x));
  const bottom=Math.min(image.height,Math.ceil(window.top+window.height+y));
  return {left,top,width:right-left,height:bottom-top};
}
export function projectContextRegion(region,context,image) {
  validWindow(image,context);
  if(['left','top','width','height'].some(k=>!Number.isFinite(region?.[k]))
    ||region.left<0||region.top<0||region.width<=0||region.height<=0
    ||region.left+region.width>1.000001||region.top+region.height>1.000001)
    throw Error('Invalid context region');
  return {left:context.left+context.width*region.left,top:context.top+context.height*region.top,
    width:context.width*region.width,height:context.height*region.height,score:region.score};
}
export function contextBoundaryRelation(window,region) {
  // An inferred detector rectangle extending outside a crop is a diagnostic
  // clue only. It must never clear a recorded code/prefix conflict by itself.
  const area=box=>box.width*box.height;
  if([window,region].some(b=>['left','top','width','height'].some(k=>!Number.isFinite(b?.[k]))||b.width<=0||b.height<=0))
    throw Error('Invalid boundary geometry');
  const intersection=Math.max(0,Math.min(window.left+window.width,region.left+region.width)-Math.max(window.left,region.left))
    *Math.max(0,Math.min(window.top+window.height,region.top+region.height)-Math.max(window.top,region.top));
  return {overlaps:intersection>0,regionFractionInside:intersection/area(region),
    extendsLeft:region.left<window.left,extendsRight:region.left+region.width>window.left+window.width,
    extendsTop:region.top<window.top,extendsBottom:region.top+region.height>window.top+window.height,
    physicalCodeExtentVerified:false,mayClearCodeConflict:false};
}
export async function detectCodeWindowContext(detector,decoded,window,{normalized=false,scale=3,maxRegions=100,...contextOptions}={}) {
  const image={width:decoded.raw.width,height:decoded.raw.height};
  if(!Number.isFinite(scale)||scale<1||scale>3||!Number.isSafeInteger(maxRegions)||maxRegions<1||maxRegions>1000)
    throw Error('Invalid diagnostic budget');
  const context=codeWindowContext(image,window,contextOptions);
  let view=sharp(decoded.data,{raw:decoded.raw}).extract(context);
  if(normalized)view=view.greyscale().normalize();
  const bytes=await view.resize({width:Math.round(context.width*scale)}).png().toBuffer();
  const result=await detector.detect(bytes);
  if(!Array.isArray(result.regions)||result.regions.length>maxRegions)throw Error('Incomplete context detection');
  const regions=result.regions.map(r=>projectContextRegion(r,context,image));
  return {context,regions:regions.map(region=>({region,relation:contextBoundaryRelation(window,region)})),
    status:'diagnostic-only-not-binding',normalized,scale};
}
