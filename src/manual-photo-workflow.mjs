import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MAX_IMAGE_BYTES} from './photos.mjs';
import {createPhotoInputBinding} from './recognition-provenance.mjs';

const require=createRequire(import.meta.url);
const sharp=require('sharp');
const IMAGE_EXTENSIONS=new Set(['.jpg','.jpeg','.png']);
const SCENE_STEMS=new Set(['2.1','2.2','2.5','2.6']);

const byName=(a,b)=>path.basename(a).localeCompare(path.basename(b),'zh-CN');
const sha256=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceIdentity=(sourceRoot,date,sourceFileHashes)=>crypto.createHash('sha256').update(JSON.stringify({sourceRoot,date,sourceFileHashes})).digest('hex');
function writeJson(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=`${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary,JSON.stringify(value,null,2));
  fs.renameSync(temporary,file);
}
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
  // Reading from a Buffer avoids libvips retaining a Windows file handle
  // while the preparation transaction later renames this same file.
  try {metadata=await sharp(fs.readFileSync(file)).metadata();}
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
function numberConflictMessages(files, conflicts) {
  return [...conflicts].map(target => {
    const names=files.filter(file=>targetName(file).toLowerCase()===target).map(file=>path.basename(file));
    return `编号 ${path.parse(target).name} 重复：${names.join('、')}。每个编号只能上传一张福单照片，请对照纸面右上角末号修改文件名。`;
  });
}

export async function planManualNumberedPreparation({photoDir,date}) {
  const files=imageFiles(photoDir),groups=classify(files),accepted=[...groups.blessing,...groups.lampScenes,...groups.waterScenes];
  const issues=[];
  if(groups.unexpected.length)issues.push(`以下照片尚未人工编号：${groups.unexpected.map(file=>path.basename(file)).join('、')}。请先改成纯数字编号；供灯使用 2.1/2.2，供水使用 2.5/2.6。`);
  if(!groups.blessing.length)issues.push('没有发现人工编号的纯数字福单照片。');
  const conflicts=targetConflicts(accepted);
  issues.push(...numberConflictMessages(accepted,conflicts));
  const assignments=[];
  for(const file of accepted) {
    let metadata;
    try {metadata=await sharp(fs.readFileSync(file)).metadata();}
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

function hashManifestFiles(files,fileHashes) {
  const hash=crypto.createHash('sha256');
  for(const file of [...files].sort(byName)) {
    const stat=fs.statSync(file);
    hash.update(`${path.basename(file)}\0${stat.size}\0${fileHashes[path.basename(file)]}\n`);
  }
  return hash.digest('hex');
}

// Encode in local state and preserve the same upload bytes across restarts.
// Verified source writeback creates a new source identity alias to this mirror;
// unrelated synchronization revisions still get an independent snapshot.
export function ensureManualPhotoMirror({root,date,workDir}) {
  const sourceRoot=path.resolve(root),localWorkDir=path.resolve(workDir);
  const relative=path.relative(sourceRoot,localWorkDir);
  if(!relative.startsWith('..')&&!path.isAbsolute(relative))throw Error('照片本机工作目录不能位于原始照片目录内部。');
  const sourcePhotoDir=path.join(dayFolder(sourceRoot,date),'1');
  const files=imageFiles(sourcePhotoDir);
  const sourceFileHashes=Object.fromEntries(files.map(file=>[path.basename(file),sha256(file)]));
  const identity=sourceIdentity(sourceRoot,date,sourceFileHashes);
  const mirrorBase=path.join(localWorkDir,'manual-photo-mirrors');
  const aliasFile=path.join(mirrorBase,'source-bindings',`${identity}.json`);
  const alias=fs.existsSync(aliasFile)?JSON.parse(fs.readFileSync(aliasFile,'utf8')):null;
  if(alias&&!/^[a-f0-9]{64}$/.test(alias.mirrorIdentity))throw Error('本机照片工作副本来源别名无效。');
  const mirrorRoot=path.join(mirrorBase,alias?.mirrorIdentity||identity);
  const mirrorPhotoDir=path.join(dayFolder(mirrorRoot,date),'1');
  const marker=path.join(mirrorRoot,'mirror-source.json');
  if(fs.existsSync(mirrorRoot)) {
    if(!fs.existsSync(marker))throw Error(`本机照片工作副本不完整，请检查：${mirrorRoot}`);
    const saved=JSON.parse(fs.readFileSync(marker,'utf8'));
    const sourceMatches=saved.identity===identity||
      (saved.sourceWriteback?.identity===identity&&JSON.stringify(saved.sourceWriteback.sourceFileHashes)===JSON.stringify(sourceFileHashes));
    if(!sourceMatches||saved.sourceRoot!==sourceRoot||saved.businessDate!==date||saved.identity!==path.basename(mirrorRoot))
      throw Error('本机照片工作副本来源校验失败，已停止处理。');
    for(const file of files) {
      const name=path.basename(file),normalized=`${path.parse(name).name}.jpg`;
      if(!fs.existsSync(path.join(mirrorPhotoDir,name))&&!fs.existsSync(path.join(mirrorPhotoDir,normalized)))
        throw Error(`本机照片工作副本缺少 ${name}，已停止处理；原图保持不变。`);
    }
    return {root:mirrorRoot,sourceRoot,sourcePhotoDir,sourceFileHashes,identity:saved.identity,reused:true};
  }
  fs.mkdirSync(mirrorBase,{recursive:true});
  const temporary=fs.mkdtempSync(path.join(mirrorBase,'.copy-'));
  try {
    const targetDir=path.join(dayFolder(temporary,date),'1');
    fs.mkdirSync(targetDir,{recursive:true});
    for(const source of files) {
      const name=path.basename(source),target=path.join(targetDir,name);
      fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
      if(sha256(target)!==sourceFileHashes[name]||sha256(source)!==sourceFileHashes[name])
        throw Error(`复制 ${name} 时原图发生变化；本机副本未启用。`);
    }
    fs.writeFileSync(path.join(temporary,'mirror-source.json'),JSON.stringify({schemaVersion:1,identity,sourceRoot,sourcePhotoDir,businessDate:date,sourceFileHashes,createdAt:new Date().toISOString()},null,2));
    fs.renameSync(temporary,mirrorRoot);
  } catch(error) {
    try {fs.rmSync(temporary,{recursive:true,force:true});} catch {}
    throw error;
  }
  return {root:mirrorRoot,sourceRoot,sourcePhotoDir,sourceFileHashes,identity,reused:false};
}

export function manualSourceNormalizationPending(mirror,date) {
  const photoDir=path.join(dayFolder(mirror.root,date),'1');
  return Object.entries(mirror.sourceFileHashes).filter(([name,hash])=>{
    const target=path.join(photoDir,`${path.parse(name).name}.jpg`);
    return fs.existsSync(target)&&hash!==sha256(target);
  }).length;
}

// The old source transaction required DELETE sharing (rename/unlink), although
// saving an existing numbered JPG requires only WRITE sharing. Use a Windows
// handle that excludes competing writers while allowing compatible readers.
export async function commitManualPhotoSources({mirror,date,workDir,attempts=8,delayMs=500}) {
  const mirrorDir=path.join(dayFolder(mirror.root,date),'1');
  const manifest=await scanManualNumberedWorkday(mirror.root,date);
  if(!manifest.normalizationReady)throw Error('上传副本尚未通过规格检查，原目录未修改。');
  let originals=imageFiles(mirror.sourcePhotoDir);
  const originalNames=originals.map(file=>path.basename(file));
  if(JSON.stringify(originalNames)!==JSON.stringify(Object.keys(mirror.sourceFileHashes)))throw Error('原目录文件集合发生变化，请重新检查；未写回照片。');
  for(const source of originals) {
    const name=path.basename(source),prepared=path.join(mirrorDir,`${path.parse(name).name}.jpg`),current=sha256(source);
    if(!fs.existsSync(prepared)||(current!==mirror.sourceFileHashes[name]&&current!==sha256(prepared)))
      throw Error(`${name} 原图或来源发生变化，禁止覆盖旧副本。`);
  }
  const journalPath=path.join(workDir,'source-photo-commit.json');
  const previous=fs.existsSync(journalPath)?JSON.parse(fs.readFileSync(journalPath,'utf8')):null;
  // PNG/JPEG extension changes genuinely require rename/delete permission.
  // Preserve the existing verified conversion transaction for these files;
  // the normal numbered JPG path never needs this permission anymore.
  const conversions=originals.filter(file=>path.extname(file).toLowerCase()!=='.jpg');
  if(conversions.length) {
    const sourcePlan=await planManualNumberedPreparation({photoDir:mirror.sourcePhotoDir,date});
    if(!sourcePlan.safeToApply)throw Error('原目录转换方案未通过检查，照片未修改。');
    writeJson(journalPath,{schemaVersion:1,businessDate:date,completedAt:null,files:previous?.files||[],conversionPending:true});
    const {applyPhotoPreparation}=await import('./photo-prepare.mjs');
    const receipt=await applyPhotoPreparation({...sourcePlan,assignments:sourcePlan.assignments.filter(item=>conversions.includes(item.source))},workDir);
    writeJson(path.join(workDir,'source-conversion-receipt.json'),receipt);
    for(const item of receipt.files)if(sha256(item.target)!==sha256(path.join(mirrorDir,item.targetName)))
      throw Error('原目录转换结果与上传副本不一致，原图备份保留。');
    originals=imageFiles(mirror.sourcePhotoDir);
    mirror.sourceFileHashes=Object.fromEntries(originals.map(file=>[path.basename(file),sha256(file)]));
  }
  const backupDir=path.join(workDir,'source-photo-backups',crypto.randomUUID());
  const entries=[];
  for(const source of originals) {
    const name=path.basename(source),prepared=path.join(mirrorDir,`${path.parse(name).name}.jpg`);
    if(!fs.existsSync(prepared))throw Error(`${name} 缺少压缩成品，原目录未修改。`);
    const beforeSha256=mirror.sourceFileHashes[name],afterSha256=sha256(prepared),currentHash=sha256(source);
    const prior=previous?.files?.find(entry=>entry.source===source&&entry.afterSha256===afterSha256&&entry.status==='verified');
    if(currentHash!==beforeSha256&&currentHash!==afterSha256)throw Error(`${name} 原图发生变化，禁止覆盖旧副本。`);
    if(currentHash===afterSha256) {
      entries.push(prior?{...prior,prepared}:{source,prepared,beforeSha256,afterSha256,backup:null,status:'verified'});
      continue;
    }
    entries.push({source,prepared,beforeSha256,afterSha256,backup:path.join(backupDir,name),status:'pending'});
  }
  const pending=entries.filter(entry=>entry.status!=='verified');
  if(pending.length) {
    if(process.platform!=='win32')throw Error('原目录安全保存需要 Windows 文件共享控制。');
    fs.mkdirSync(backupDir,{recursive:true});
    const plan={schemaVersion:1,businessDate:date,journalPath,attempts,delayMs,completedAt:null,files:entries};
    const planPath=path.join(workDir,`source-photo-save-${crypto.randomUUID()}.json`);
    writeJson(planPath,plan);
    writeJson(journalPath,plan);
    const helper=fileURLToPath(new URL('../ui/Write-PreparedPhotos.ps1',import.meta.url));
    const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-PlanPath',planPath],
      {encoding:'utf8',windowsHide:true,timeout:60000});
    try {fs.unlinkSync(planPath);} catch {}
    if(result.error||result.status!==0)throw Error(String(result.stderr||result.error?.message||'原目录安全保存失败，备份已保留。').trim());
  }
  const receipt=pending.length?JSON.parse(fs.readFileSync(journalPath,'utf8')):{schemaVersion:1,businessDate:date,files:entries};
  for(const entry of receipt.files)if(sha256(entry.source)!==entry.afterSha256||sha256(entry.prepared)!==entry.afterSha256)
    throw Error('原目录或上传成品在保存后发生变化，已停止；原图备份保留。');
  const sourceFileHashes=Object.fromEntries(imageFiles(mirror.sourcePhotoDir).map(file=>[path.basename(file),sha256(file)]));
  const expectedSourceHashes=Object.fromEntries(receipt.files.map(entry=>[path.basename(entry.source),entry.afterSha256]));
  if(JSON.stringify(sourceFileHashes)!==JSON.stringify(expectedSourceHashes))throw Error('原目录文件集合或内容在核验期间发生变化，已停止；请重新检查。');
  const identity=sourceIdentity(mirror.sourceRoot,date,sourceFileHashes);
  const marker=path.join(mirror.root,'mirror-source.json'),saved=JSON.parse(fs.readFileSync(marker,'utf8'));
  saved.sourceWriteback={identity,sourceFileHashes,verifiedAt:new Date().toISOString()};
  writeJson(marker,saved);
  writeJson(path.join(path.dirname(mirror.root),'source-bindings',`${identity}.json`),{mirrorIdentity:mirror.identity});
  mirror.sourceFileHashes=sourceFileHashes;
  receipt.processedCount=pending.length+conversions.length;
  receipt.completedAt=new Date().toISOString();
  writeJson(journalPath,receipt);
  return receipt;
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
  blockingErrors.push(...numberConflictMessages([...groups.blessing,...groups.lampScenes,...groups.waterScenes],conflicts));
  // Content conflicts prevent uploading ambiguous manual numbers, but do not
  // prevent the same verified normalization from being saved to originals.
  const normalizationReady=blockingErrors.length===0&&groups.blessing.length>0;
  const sceneManualIssues=[];
  if(groups.lampScenes.length>2)sceneManualIssues.push(`供灯场景图超过平台允许的2张：${groups.lampScenes.map(file=>path.basename(file)).join('、')}。`);
  if(groups.waterScenes.length>2)sceneManualIssues.push(`供水场景图超过平台允许的2张：${groups.waterScenes.map(file=>path.basename(file)).join('、')}。`);
  const digestFiles=[...groups.blessing,...groups.lampScenes,...groups.waterScenes];
  const inputFileHashes=Object.fromEntries(files.map(file=>[path.basename(file),sha256(file)]));
  const fileHashes=Object.fromEntries(digestFiles.map(file=>[path.basename(file),inputFileHashes[path.basename(file)]]));
  const blessingNamesByHash=new Map();
  for(const file of groups.blessing) {
    const name=path.basename(file),hash=fileHashes[name];
    if(!blessingNamesByHash.has(hash))blessingNamesByHash.set(hash,[]);
    blessingNamesByHash.get(hash).push(name);
  }
  const duplicateBlessingGroups=[...blessingNamesByHash.values()].filter(names=>names.length>1);
  for(const names of duplicateBlessingGroups)blockingErrors.push(
    `不同编号的福单照片内容完全相同：${names.join('、')}。请人工核对照片和编号后再上传；软件未删除照片，也未自动选择编号。`);
  return {
    schemaVersion:4,manualNumberedMode:true,recognitionDisabled:true,businessDate:date,createdAt:new Date().toISOString(),folder,photoDir,
    expectedPrintedPrefix:null,
    counts:{allImages:files.length,blessing:groups.blessing.length,lampScene:groups.lampScenes.length,waterScene:groups.waterScenes.length,
      unexpected:groups.unexpected.length,foreignBlessing:0,reviewExcluded:0,pdf:0,pdfPages:0,missingBlessing:0,unmatchedBlessing:0,extraBlessing:0},
    photoAvailability:{schemaVersion:2,unmatchedPages:0,unmatchedNumbers:[],unclassifiedPhotos:groups.unexpected.length,
      unclassifiedFiles:groups.unexpected.map(file=>path.basename(file)),summary:'人工编号模式不读取或比对 PDF。'},
    files:{blessing:groups.blessing,lampScenes:groups.lampScenes,waterScenes:groups.waterScenes,unexpected:groups.unexpected,foreignBlessing:[],reviewExcluded:[]},
    inspections,ocrSuggestions:[],pdfs:[],errors:[...blockingErrors,...sceneManualIssues],blockingErrors,manualIssues:[...sceneManualIssues],sceneManualIssues,
    requiredSceneModes:[],warnings:[],normalizationReady,duplicateBlessingGroups,
    blessingReady:blockingErrors.length===0,uploadReady:blockingErrors.length===0&&groups.blessing.length>0,
    batchCompleteReady:blockingErrors.length===0&&sceneManualIssues.length===0,fileHashes,inputFileHashes,
    fileSetHash:digestFiles.length?hashManifestFiles(digestFiles,fileHashes):null,
  };
}
