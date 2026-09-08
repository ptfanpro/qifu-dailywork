// Diagnostic-only local text proposals. No PDF, date, filename or expected code.
// Overlap preserves small lines near tile boundaries; proposals are NOT votes.
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url), sharp = require('sharp');

function integer(value, minimum, name) {
  if (!Number.isSafeInteger(value) || value < minimum) throw Error(`Invalid ${name}`);
  return value;
}
function starts(size, edge, overlap) {
  const result = [0];
  while (result.at(-1) + edge < size) result.push(Math.min(size - edge, result.at(-1) + edge - overlap));
  return result;
}
export function textTiles(width, height, {tileWidth=640, tileHeight=480, overlapX=160, overlapY=120, maxTiles=64}={}) {
  integer(width, 1, 'width'); integer(height, 1, 'height');
  integer(tileWidth, 1, 'tile width'); integer(tileHeight, 1, 'tile height');
  integer(overlapX, 0, 'horizontal overlap'); integer(overlapY, 0, 'vertical overlap');
  integer(maxTiles, 1, 'tile limit');
  if (overlapX >= tileWidth || overlapY >= tileHeight) throw Error('Overlap must be smaller than tile');
  const w=Math.min(width,tileWidth), h=Math.min(height,tileHeight);
  const xs=starts(width,w,Math.min(overlapX,w-1)), ys=starts(height,h,Math.min(overlapY,h-1));
  if (xs.length * ys.length > maxTiles) throw Error('Tile limit exceeded; not a complete detection');
  return ys.flatMap(top=>xs.map(left=>({left,top,width:w,height:h})));
}
export function projectTextRegion(region, tile, image) {
  for (const key of ['left','top','width','height']) if (!Number.isFinite(region[key])) throw Error('Invalid detector region');
  if (region.left<0 || region.top<0 || region.width<=0 || region.height<=0 ||
      region.left+region.width>1.000001 || region.top+region.height>1.000001) throw Error('Region outside tile');
  return {left:(tile.left+region.left*tile.width)/image.width,
    top:(tile.top+region.top*tile.height)/image.height,
    width:region.width*tile.width/image.width, height:region.height*tile.height/image.height,
    score:region.score};
}
export async function detectTiledText(detector, source, {normalize=false, scale=2, ...tileOptions}={}) {
  if (!Number.isFinite(scale) || scale<1 || scale>3) throw Error('Invalid diagnostic scale');
  const original=await sharp(source).rotate().toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true});
  const tiles=textTiles(original.info.width,original.info.height,tileOptions), regions=[];
  for (let tileIndex=0;tileIndex<tiles.length;tileIndex++) {
    const tile=tiles[tileIndex];
    let view=sharp(original.data,{raw:original.info}).extract(tile);
    if(normalize) view=view.greyscale().normalize();
    const bytes=await view.resize({width:Math.round(tile.width*scale)}).png().toBuffer();
    const detected=await detector.detect(bytes);
    for(const region of detected.regions) regions.push({...projectTextRegion(region,tile,original.info),tileIndex});
  }
  return {original,regions,tiles,normalize,scale};
}
