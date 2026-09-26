import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {MAX_IMAGE_BYTES} from './photos.mjs';
import {createPhotoInputBinding} from './recognition-provenance.mjs';

const require=createRequire(import.meta.url);
const sharp=require('sharp');
const IMAGE_EXTENSIONS=new Set(['.jpg','.jpeg','.png']);
const SCENE_STEMS=new Set(['2.1','2.2','2.5','2.6']);

const byName=(a,b)=>path.basename(a).localeCompare(path.basename(b),'zh-CN');
const sha256=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const orientedSize=metadata=>[5,6,7,8].includes(Number(metadata.orientation||1))
  ? {width:Number(metadata.height||0),height:Number(metadata.width||0)}
  : {width:Number(metadata.width||0),height:Number(metadata.height||0)};

function dayFolder(root,date) {
  const [year,month,day]=String(date||'').split('-').map(Number);
  if(!year||!month||!day)throw Error(`无效业务日期：${date}`);
  return path.join(root,`${month}月${day}日`);
}

function imageFiles(photoDir) {
  if(!fs.existsSync(photoDir)||!fs.statSync(photoDir).isDirectory())throw Error(`没有找到照片目录：${photoDir}`);
  return fs.readdirSync(photoDir,{withFileTypes:true})
    .filter(entry=>entry.isFile()&&IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map(entry=>path.join(photoDir,entry.name)).sort(byName);
}

function classify(files) {
  const blessing=[],lampScenes=[],waterScenes=[],unexpected=[];
  for(const file of files) {
    const stem=path.parse(file).name;
    if(/^\d+$/.test(stem)&&Number.isSafeInteger(Number(stem))&&Number(stem)>0)blessing.push(file);
    else if(stem==='2.1'||stem==='2.2')lampScenes.push(file);
    else if(stem==='2.5'||stem==='2.6')waterScenes.push(file);
    else unexpected.push(file);
  }
  return {blessing,lampScenes,waterScenes,unexpected};
}

async function inspect(file,kind) {
  const errors=[];
  let metadata={};
  try {metadata=await sharp(file).metadata();}
  catch {errors.push('图片无法读取');}
  const {width,height}=orientedSize(metadata),ext=path.extname(file).toLowerCase(),bytes=fs.statSync(file).size;
  if(ext!=='.jpg'||metadata.format!=='jpeg')errors.push('必须输出为 JPG');
  if(bytes>MAX_IMAGE_BYTES)errors.push('文件超过 1.5 MiB');
  if(!width||!height)errors.push('图片尺寸无效');
  if(width&&height&&(width!==1800||height!==1350))errors.push('尺寸必须为 1800×1350');
  return {file,name:path.basename(file),kind,bytes,width,height,format:metadata.format||null,errors,ok:errors.length===0};
}

function targetName(file) {return `${path.parse(file).name}.jpg`;}

function targetConflicts(files) {
  const counts=new Map();
  for(const file of files) {
    const name=targetName(file).toLowerCase();
    counts.set(name,(counts.get(name)||0)+1);
  }
  return new Set([...counts].filter(([,count])=>count>1).map(([name])=>name));
}

export async function planManualNumberedPreparation({photoDir,date}) {
  const files=imageFiles(photoDir),groups=classify(files),accepted=[...groups.blessing,...groups.lampScenes,...groups.waterScenes];
  const issues=[];
  if(groups.unexpected.length)issues.push(`以下照片尚未人工编号：${groups.unexpected.map(file=>path.basename(file)).join('、')}。请先改成纯数字编号；供灯使用 2.1/2.2，供水使用 2.5/2.6。`);
  if(!groups.blessing.length)issues.push('没有发现人工编号的纯数字福单照片。');
  const conflicts=targetConflicts(accepted);
  if(conflicts.size)issues.push(`以下人工编号存在同名目标冲突：${[...conflicts].join('、')}。请只保留每个编号的一张照片。`);
  const assignments=[];
  for(const file of accepted) {
    let metadata;
    try {metadata=await sharp(file).metadata();}
    catch {issues.push(`${path.basename(file)}：图片无法读取。`);continue;}
    const {width,height}=orientedSize(metadata),name=targetName(file),sameTarget=path.resolve(file)===path.resolve(photoDir,name);
    if(conflicts.has(name.toLowerCase()))continue;
    if(fs.existsSync(path.join(photoDir,name))&&!sameTarget) {
      issues.push(`${path.basename(file)}：目标文件 ${name} 已存在。`);continue;
    }
    const needsNormalization=path.extname(file).toLowerCase()!=='.jpg'||metadata.format!=='jpeg'||fs.statSync(file).size>MAX_IMAGE_BYTES
      ||width!==1800||height!==1350;
    if(!needsNormalization)continue;
    const stem=path.parse(file).name;
    assignments.push({source:file,targetName:name,
      kind:/^\d+$/.test(stem)?'blessing':(stem==='2.1'||stem==='2.2'?'scene-lamp':'scene-water'),
      evidence:{method:'manual-numbered-spec-normalization'}});
  }
  const uniqueIssues=[...new Set(issues)];
  return {
    schemaVersion:1,manualNumberedMode:true,recognitionDisabled:true,businessDate:date,createdAt:new Date().toISOString(),
    photoDir,photoInputBinding:createPhotoInputBinding(photoDir,files),photoReviewExclusions:{schemaVersion:1,files:[]},
    assignments,unresolvedStandardizations:[],duplicateSources:[],allowedBlessingNumbers:groups.blessing.map(file=>Number(path.parse(file).name)).sort((a,b)=>a-b),
    bodyClaimReview:{status:'not-needed'},pdfPages:[],missingExpected:[],pendingIssues:[],issues:uniqueIssues,
    safeToApply:uniqueIssues.length===0,ready:uniqueIssues.length===0,
  };
}

function hashManifestFiles(files) {
  const hash=crypto.createHash('sha256');
  for(const file of [...files].sort(byName)) {
    const stat=fs.statSync(file);
    hash.update(`${path.basename(file)}\0${stat.size}\0${sha256(file)}\n`);
  }
  return hash.digest('hex');
}

export async function scanManualNumberedWorkday(root,date) {
  const folder=dayFolder(root,date),photoDir=path.join(folder,'1'),files=imageFiles(photoDir),groups=classify(files);
  const inspections=[];
  for(const file of groups.blessing)inspections.push(await inspect(file,'blessing'));
  for(const file of groups.lampScenes)inspections.push(await inspect(file,'scene-lamp'));
  for(const file of groups.waterScenes)inspections.push(await inspect(file,'scene-water'));
  const blockingErrors=inspections.flatMap(item=>item.errors.map(message=>`${item.name}：${message}`));
  if(groups.unexpected.length)blockingErrors.push(`以下照片尚未人工编号，未进入上传清单：${groups.unexpected.map(file=>path.basename(file)).join('、')}。`);
  if(!groups.blessing.length)blockingErrors.push('没有发现人工编号的纯数字福单照片。');
  const conflicts=targetConflicts([...groups.blessing,...groups.lampScenes,...groups.waterScenes]);
  if(conflicts.size)blockingErrors.push(`人工编号重复：${[...conflicts].join('、')}。`);
  const sceneManualIssues=[];
  if(groups.lampScenes.length>2)sceneManualIssues.push(`供灯场景图超过平台允许的2张：${groups.lampScenes.map(file=>path.basename(file)).join('、')}。`);
  if(groups.waterScenes.length>2)sceneManualIssues.push(`供水场景图超过平台允许的2张：${groups.waterScenes.map(file=>path.basename(file)).join('、')}。`);
  const digestFiles=[...groups.blessing,...groups.lampScenes,...groups.waterScenes];
  const fileHashes=Object.fromEntries(digestFiles.map(file=>[path.basename(file),sha256(file)]));
  const inputFileHashes=Object.fromEntries(files.map(file=>[path.basename(file),sha256(file)]));
  return {
    schemaVersion:4,manualNumberedMode:true,recognitionDisabled:true,businessDate:date,createdAt:new Date().toISOString(),folder,photoDir,
    expectedPrintedPrefix:null,
    counts:{allImages:files.length,blessing:groups.blessing.length,lampScene:groups.lampScenes.length,waterScene:groups.waterScenes.length,
      unexpected:groups.unexpected.length,foreignBlessing:0,reviewExcluded:0,pdf:0,pdfPages:0,missingBlessing:0,unmatchedBlessing:0,extraBlessing:0},
    photoAvailability:{schemaVersion:2,unmatchedPages:0,unmatchedNumbers:[],unclassifiedPhotos:groups.unexpected.length,
      unclassifiedFiles:groups.unexpected.map(file=>path.basename(file)),summary:'人工编号模式不读取或比对 PDF。'},
    files:{blessing:groups.blessing,lampScenes:groups.lampScenes,waterScenes:groups.waterScenes,unexpected:groups.unexpected,foreignBlessing:[],reviewExcluded:[]},
    inspections,ocrSuggestions:[],pdfs:[],errors:[...blockingErrors,...sceneManualIssues],blockingErrors,manualIssues:[...sceneManualIssues],sceneManualIssues,
    requiredSceneModes:[],warnings:[],blessingReady:blockingErrors.length===0,uploadReady:blockingErrors.length===0&&groups.blessing.length>0,
    batchCompleteReady:blockingErrors.length===0&&sceneManualIssues.length===0,fileHashes,inputFileHashes,
    fileSetHash:digestFiles.length?hashManifestFiles(digestFiles):null,
  };
}
