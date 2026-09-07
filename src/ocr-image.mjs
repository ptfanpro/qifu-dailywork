import {createRequire} from 'node:module';
import fs from 'node:fs';
const sharp=createRequire(import.meta.url)('sharp');
// libvips' native filename writer can reject Windows paths above MAX_PATH
// even when Node can create the directory. Encode unchanged bytes in memory
// and let Node perform the filesystem operation. Preserve format and info.
export async function writeImageFile(image,file) {
  const {data,info}=await image.toBuffer({resolveWithObject:true});
  fs.writeFileSync(file,data);
  return info;
}
export async function decodeOcrSource(source) {
  const {data,info}=await sharp(source).rotate().raw().toBuffer({resolveWithObject:true});
  return {data,raw:{width:info.width,height:info.height,channels:info.channels}};
}
export async function extractOcrCrop(decoded,extract,{normalized=false}={}) {
  let image=sharp(decoded.data,{raw:decoded.raw}).extract(extract);
  if(normalized) image=image.greyscale().normalize().sharpen({sigma:1});
  return image.png().toBuffer();
}
