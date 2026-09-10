// Frozen, content-only foreground experiment. These windows do not assert
// depth or remove the full frame. No historical role/date/filename is input.
import {createRequire} from 'node:module';
import {createClipRoleReader} from './clip-role-reader.mjs';
const sharp=createRequire(import.meta.url)('sharp');
export const SPATIAL_WINDOWS=Object.freeze([
  {name:'full',left:0,top:0,width:1,height:1},
  {name:'middle',left:.15,top:.25,width:.7,height:.7},
  {name:'lower-half',left:0,top:.5,width:1,height:.5},
  {name:'lower-quarter',left:0,top:.75,width:1,height:.25},
].map(Object.freeze));
export function summarizeSpatialRoles(rows) {
  if(rows.length!==SPATIAL_WINDOWS.length||new Set(rows.map(r=>r.name)).size!==rows.length
    ||SPATIAL_WINDOWS.some(w=>!rows.some(r=>r.name===w.name)))throw Error('Incomplete spatial evidence');
  const byName=Object.fromEntries(rows.map(r=>[r.name,r.result.candidate]));
  const foreground=[byName['lower-half'],byName['lower-quarter']];
  let candidate=null;
  if(foreground.every(r=>r===foreground[0])&&['water','lamp'].includes(foreground[0]))candidate=foreground[0];
  else if(byName.full==='paper'&&byName.middle==='paper'&&byName['lower-half']==='paper')candidate='paper';
  return {candidate,windowRoles:byName,rows,bindingVerified:false,semanticVerified:false,
    mayAssignNumber:false,mayUploadScene:false,mayClearCodeConflict:false};
}
export async function createSpatialRoleReader(appRoot,modelDir) {
  const reader=await createClipRoleReader(appRoot,modelDir);
  return {identity:{...reader.identity,windows:SPATIAL_WINDOWS,method:'two-lower-windows-agree-v1'},
    async read(source) {
      const original=await sharp(source).rotate().toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true});
      const rows=[];
      for(const region of SPATIAL_WINDOWS) {
        const left=Math.floor(region.left*original.info.width),top=Math.floor(region.top*original.info.height);
        const width=Math.min(original.info.width-left,Math.floor(region.width*original.info.width));
        const height=Math.min(original.info.height-top,Math.floor(region.height*original.info.height));
        const pixels=await sharp(original.data,{raw:original.info}).extract({left,top,width,height}).png().toBuffer();
        rows.push({name:region.name,crop:{left,top,width,height},result:await reader.read(pixels)});
      }
      return summarizeSpatialRoles(rows);
    },release:()=>reader.release()};
}
