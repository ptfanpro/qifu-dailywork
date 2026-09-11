// Diagnostic-only printed-shape comparison. No OCR answers, dates, filenames,
// PDF ranges, missing-number counts, or order IDs are inputs. All glyphs stay
// in their original sequence. No ranking in this experiment authorizes a fix.
export const CODE_GLYPH_RECIPE='otsu-column-runs-glyph16x24-minimum-dice-v1';
const GW=16,GH=24;
function threshold(data){
  const hist=new Uint32Array(256);let sum=0;
  for(const value of data){hist[value]++;sum+=value;}
  let left=0,leftSum=0,best=-1,cut=0;
  for(let t=0;t<255;t++){
    left+=hist[t];leftSum+=t*hist[t];const right=data.length-left;
    if(!left||!right)continue;
    const delta=leftSum/left-(sum-leftSum)/right,score=left*right*delta*delta;
    if(score>best){best=score;cut=t;}
  }
  return best<0?null:cut;
}
export function describePrintedGlyphs(data,width,height){
  if(!(data instanceof Uint8Array)||!Number.isInteger(width)||!Number.isInteger(height)
    ||width<1||height<1||width>4096||height>512||data.length!==width*height)
    throw Error('Bounded grayscale pixels required');
  const cut=threshold(data);
  const empty=status=>({recipe:CODE_GLYPH_RECIPE,status,width,height,threshold:cut,glyphs:[]});
  if(cut===null)return empty('blank');
  const ink=new Uint8Array(data.length),columns=new Uint32Array(width);
  let top=height,bottom=-1,total=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[y*width+x]<=cut){
    ink[y*width+x]=1;columns[x]++;top=Math.min(top,y);bottom=Math.max(bottom,y);total++;
  }
  if(!total)return empty('blank');
  if(total/data.length>.6)return empty('foreground-not-isolated');
  // Do not discard disconnected marks or select a subset that looks like an
  // expected answer. Extra marks and touching glyphs remain count mismatches.
  const spans=[];
  for(let x=0;x<width;){
    if(!columns[x]){x++;continue;}
    const left=x;while(x<width&&columns[x])x++;
    spans.push({left,right:x});
  }
  if(spans.length<6||spans.length>10)return {...empty('unsupported-glyph-segmentation'),segmentCount:spans.length};
  const lineHeight=bottom-top+1;
  const glyphs=spans.map(({left,right})=>{
    const pixels=[];
    for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
      const sx=left+Math.min(right-left-1,Math.floor((x+.5)*(right-left)/GW));
      const sy=top+Math.min(lineHeight-1,Math.floor((y+.5)*lineHeight/GH));
      pixels.push(ink[sy*width+sx]);
    }
    return {left,right,aspect:(right-left)/lineHeight,pixels};
  });
  return {recipe:CODE_GLYPH_RECIPE,status:'described',width,height,threshold:cut,
    bounds:{left:spans[0].left,top,width:spans.at(-1).right-spans[0].left,height:lineHeight},glyphs};
}
function validate(word){
  if(!word||word.recipe!==CODE_GLYPH_RECIPE||!Array.isArray(word.glyphs))throw Error('Invalid glyph observation');
  if(word.status!=='described')return false;
  if(word.glyphs.length<6||word.glyphs.length>10||word.glyphs.some(g=>!Number.isFinite(g.aspect)||g.aspect<=0
    ||!Array.isArray(g.pixels)||g.pixels.length!==GW*GH||g.pixels.some(p=>p!==0&&p!==1)||!g.pixels.includes(1)))
    throw Error('Invalid individual glyph pixels');
  return true;
}
function dice(a,b){
  let intersection=0,total=0;
  for(let i=0;i<a.pixels.length;i++){intersection+=a.pixels[i]*b.pixels[i];total+=a.pixels[i]+b.pixels[i];}
  // Retain width/height shape information as well as normalized ink.
  return 2*intersection/total*Math.min(a.aspect/b.aspect,b.aspect/a.aspect);
}
export function comparePrintedGlyphs(observed,templates){
  const ready=validate(observed),ids=new Set(),rankings=[],rejected=[];
  if(!Array.isArray(templates)||templates.length>10000)throw Error('Bounded template collection required');
  for(const item of templates){
    if(typeof item?.id!=='string'||!item.id||ids.has(item.id))throw Error('Unique opaque template identity required');
    ids.add(item.id);const valid=validate(item.glyphs);
    if(!ready||!valid){rejected.push({id:item.id,reason:'glyph-segmentation-unavailable'});continue;}
    if(item.glyphs.glyphs.length!==observed.glyphs.length){rejected.push({id:item.id,reason:'glyph-count-differs'});continue;}
    const perGlyph=observed.glyphs.map((g,i)=>dice(g,item.glyphs.glyphs[i]));
    rankings.push({id:item.id,perGlyph,minimum:Math.min(...perGlyph),mean:perGlyph.reduce((a,b)=>a+b,0)/perGlyph.length});
  }
  rankings.sort((a,b)=>b.minimum-a.minimum||b.mean-a.mean||a.id.localeCompare(b.id));
  return {recipe:CODE_GLYPH_RECIPE,rankings,rejected,
    minimumMargin:rankings.length>1?rankings[0].minimum-rankings[1].minimum:null,
    candidate:null,orderBindingVerified:false,mayAssignNumber:false,mayClearCodeConflict:false,mayAuthorizeUpload:false};
}
