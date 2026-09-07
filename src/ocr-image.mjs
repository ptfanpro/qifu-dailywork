import {createRequire} from 'node:module';
const sharp=createRequire(import.meta.url)('sharp');
export async function decodeOcrSource(source) {
  const {data,info}=await sharp(source).rotate().raw().toBuffer({resolveWithObject:true});
  return {data,raw:{width:info.width,height:info.height,channels:info.channels}};
}
export async function extractOcrCrop(decoded,extract,{normalized=false}={}) {
  let image=sharp(decoded.data,{raw:decoded.raw}).extract(extract);
  if(normalized) image=image.greyscale().normalize().sharpen({sigma:1});
  return image.png().toBuffer();
}
