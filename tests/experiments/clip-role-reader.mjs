// Offline diagnostic only. No numbering, scene-upload decision, or training.
// Public CLIP ONNX conversion, pinned files; no runtime network/download code.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),sharp=require('sharp');
export const CLIP_REVISION='6ef1ebc8b0766a7a8d11b146462c99cdf74dd22d';
export const CLIP_FILES={
  'vision_model_quantized.onnx':'583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299',
  'text_model_quantized.onnx':'73baab855d406190da9faa498cfedf65f15cf309f4cc7385b7b032e6d08e5c3a',
  'tokenizer.json':'f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd',
  'preprocessor_config.json':'6f638fb9401a6d6296feff533ee7efe657b787c49f954f82f5906b36ef2a1b1f',
};
// Fixed before the first real-image trial. No customer, date, code or filename
// appears in these descriptions. Do not tune on individual evaluation answers.
export const ROLE_PROMPTS={
  paper:[
    'a photograph of a printed red paper document on a stand in a temple.',
    'a photograph of a printed yellow paper document on a stand in a temple.',
    'a photograph of a large sheet of paper with Chinese writing in the foreground.',
    'a photograph of a prayer document in front of a Buddhist altar.',
  ],
  water:[
    'a photograph of rows of bowls filled with water on a Buddhist altar.',
    'a photograph of many water offering cups arranged on steps in a temple.',
    'a photograph of a table covered with small water bowls.',
    'a photograph of water offerings in the foreground of a Buddhist shrine.',
  ],
  lamp:[
    'a photograph of rows of burning candles on a Buddhist altar.',
    'a photograph of many lit oil lamps arranged on steps in a temple.',
    'a photograph of a table covered with glowing candle flames.',
    'a photograph of burning butter lamps in the foreground of a Buddhist shrine.',
  ],
  other:[
    'a photograph of a Buddhist statue in a temple.',
    'a photograph of a building.',
    'a photograph of flowers and fruit on a table.',
    'a photograph of an empty room.',
  ],
};
export const CLIP_VIEWS=['center-crop','full-frame'];
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');

export function clipExperimentFingerprint({reader,sourceFiles,runtimeSha256}){
  if(!reader||!Array.isArray(sourceFiles)||!sourceFiles.length
    ||sourceFiles.some(r=>!Array.isArray(r)||r.length!==2||!r[0]||!/^[a-f0-9]{64}$/.test(r[1]))
    ||!/^[a-f0-9]{64}$/.test(runtimeSha256))throw Error('Incomplete experiment identity');
  return digest(JSON.stringify({reader,sourceFiles:[...sourceFiles].sort((a,b)=>a[0].localeCompare(b[0])),runtimeSha256}));
}

export function verifyClipAssets(modelDir){
  const identities={};
  for(const [name,expected] of Object.entries(CLIP_FILES)){
    const bytes=fs.readFileSync(path.join(modelDir,name));
    const actual=digest(bytes);
    if(actual!==expected)throw Error('CLIP asset integrity mismatch: '+name);
    identities[name]=actual;
  }
  return identities;
}

// This intentionally supports only the fixed English ASCII descriptions above,
// not arbitrary user text. CLIP byte encoding is identity on these characters.
export function createAsciiClipTokenizer(tokenizer){
  const vocab=tokenizer?.model?.vocab,merges=tokenizer?.model?.merges;
  if(!vocab||!Array.isArray(merges)||tokenizer.model.end_of_word_suffix!=='</w>')throw Error('Invalid CLIP BPE');
  const ranks=new Map(merges.map((x,i)=>[Array.isArray(x)?x.join(' '):x,i]));
  return text=>{
    if(typeof text!=='string'||!/^[a-zA-Z0-9 .,!?'-]+$/.test(text))throw Error('Fixed ASCII description required');
    const tokens=text.toLowerCase().replace(/\s+/g,' ').trim().match(/'s|'t|'re|'ve|'m|'ll|'d|[a-z]+|[0-9]|[^\sa-z0-9]+/g)||[];
    const ids=[49406];
    for(const token of tokens){
      let pieces=[...token];pieces[pieces.length-1]+='</w>';
      while(pieces.length>1){
        let rank=Infinity,pair=null;
        for(let i=0;i<pieces.length-1;i++){
          const candidate=pieces[i]+' '+pieces[i+1],r=ranks.get(candidate);
          if(r!==undefined&&r<rank){rank=r;pair=candidate;}
        }
        if(pair===null)break;
        const merged=[];
        for(let i=0;i<pieces.length;i++){
          if(i+1<pieces.length&&pieces[i]+' '+pieces[i+1]===pair)merged.push(pieces[i++]+pieces[i]);
          else merged.push(pieces[i]);
        }
        pieces=merged;
      }
      for(const piece of pieces){
        if(!Number.isSafeInteger(vocab[piece]))throw Error('Unknown CLIP token');
        ids.push(vocab[piece]);
      }
    }
    ids.push(49407);
    if(ids.length>77)throw Error('Description would be truncated');
    return ids;
  };
}

export function unitVector(values){
  if(!values?.length||![...values].every(Number.isFinite))throw Error('Invalid embedding');
  const norm=Math.hypot(...values);
  if(!(norm>1e-12))throw Error('Zero embedding');
  return Float32Array.from(values,v=>v/norm);
}

export function roleCosines(image,roles){
  const vector=unitVector(image);
  return Object.entries(roles).map(([role,embedding])=>{
    if(embedding.length!==vector.length)throw Error('Embedding dimensions differ');
    const other=unitVector(embedding);
    return {role,cosine:vector.reduce((n,v,i)=>n+v*other[i],0)};
  }).sort((a,b)=>b.cosine-a.cosine||a.role.localeCompare(b.role));
}

export function summarizeRoleViews(views){
  if(!Array.isArray(views)||views.length!==CLIP_VIEWS.length)throw Error('Incomplete role views');
  const rows=CLIP_VIEWS.map(view=>{
    const matching=views.filter(v=>v.view===view);
    if(matching.length!==1)throw Error('Duplicate or missing role view');
    const ranking=matching[0].ranking;
    if(!Array.isArray(ranking)||ranking.length!==Object.keys(ROLE_PROMPTS).length
      ||new Set(ranking.map(r=>r.role)).size!==ranking.length
      ||ranking.some(r=>!Object.hasOwn(ROLE_PROMPTS,r.role)||!Number.isFinite(r.cosine)||Math.abs(r.cosine)>1.00001))
      throw Error('Invalid role ranking');
    const sorted=[...ranking].sort((a,b)=>b.cosine-a.cosine||a.role.localeCompare(b.role));
    return {view,ranking:sorted,top:sorted[0].role,margin:sorted[0].cosine-sorted[1].cosine};
  });
  const agrees=rows.every(v=>v.top===rows[0].top&&v.margin>0);
  return {status:agrees?'same-top-role-diagnostic':'disagreeing-role-views',
    candidate:agrees?rows[0].top:null,views:rows,semanticVerified:false,bindingVerified:false,
    mayAssignNumber:false,mayUploadScene:false};
}

export async function clipImageValues(bytes,view){
  if(!CLIP_VIEWS.includes(view))throw Error('Unknown image view');
  // Center crop matches the released model recipe. The separate whole-frame
  // view retains edges that center crop can remove; neither proves foreground.
  const {data,info}=await sharp(bytes).rotate().flatten({background:'white'}).toColourspace('srgb')
    .resize(224,224,{fit:view==='center-crop'?'cover':'contain',position:'centre',kernel:'cubic',background:'white'})
    .removeAlpha().raw().toBuffer({resolveWithObject:true});
  if(info.width!==224||info.height!==224||info.channels!==3)throw Error('Invalid CLIP pixels');
  const mean=[.48145466,.4578275,.40821073],std=[.26862954,.26130258,.27577711],plane=224*224;
  const out=new Float32Array(3*plane);
  for(let i=0;i<plane;i++)for(let c=0;c<3;c++)out[c*plane+i]=(data[3*i+c]/255-mean[c])/std[c];
  return out;
}

export async function createClipRoleReader(appRoot,modelDir){
  const assets=verifyClipAssets(modelDir);
  const tokenize=createAsciiClipTokenizer(JSON.parse(fs.readFileSync(path.join(modelDir,'tokenizer.json'))));
  const ort=require(path.join(appRoot,'vendor/onnxruntime-node'));
  const options={executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1,logSeverityLevel:3};
  const text=await ort.InferenceSession.create(path.join(modelDir,'text_model_quantized.onnx'),options);
  const roleEmbeddings={};
  try {
    for(const [role,prompts] of Object.entries(ROLE_PROMPTS)){
      const vectors=[];
      for(const prompt of prompts){
        const ids=tokenize(prompt),input=BigInt64Array.from([...ids,...Array(77-ids.length).fill(49407)],BigInt);
        const result=await text.run({input_ids:new ort.Tensor('int64',input,[1,77])});
        if(result.text_embeds?.dims.join(',')!=='1,512')throw Error('Invalid text output');
        vectors.push(unitVector(result.text_embeds.data));
      }
      roleEmbeddings[role]=unitVector(vectors[0].map((_,i)=>vectors.reduce((n,v)=>n+v[i],0)/vectors.length));
    }
  } finally {await text.release();}
  const vision=await ort.InferenceSession.create(path.join(modelDir,'vision_model_quantized.onnx'),options);
  return {
    identity:{revision:CLIP_REVISION,assets,promptsSha256:digest(JSON.stringify(ROLE_PROMPTS)),
      model:'CLIP-ViT-B32-int8-cpu',views:CLIP_VIEWS,scoreMeaning:'cosine-similarity-not-correctness-probability'},
    async read(bytes){
      const views=[];
      for(const view of CLIP_VIEWS){
        const pixels=await clipImageValues(bytes,view);
        const result=await vision.run({pixel_values:new ort.Tensor('float32',pixels,[1,3,224,224])});
        if(result.image_embeds?.dims.join(',')!=='1,512')throw Error('Invalid image output');
        views.push({view,ranking:roleCosines(result.image_embeds.data,roleEmbeddings)});
      }
      return summarizeRoleViews(views);
    },
    release:()=>vision.release(),
  };
}
