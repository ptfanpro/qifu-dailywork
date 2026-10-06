import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PrayerSite, resolveBlessingOrderSetUploadState } from './site.mjs';
import {finishScenePasses,waitForUploadOrderOutcome} from './photo-online.mjs';
import {getMachineLocalStateRoot} from './runtime-paths.mjs';
import { Timing } from './timing.mjs';
import { calculateQuantities, normalizeText, venueMessage } from './quantity.mjs';
import { assertSceneFilesBelongToBusinessDate, assertUnchangedManifest, dayFolder as photoDayFolder, scanPhotoWorkday, splitUploadBatches } from './photos.mjs';
import { applyPhotoPreparation, planPhotoPreparation } from './photo-prepare.mjs';
import {ensureManualPhotoMirror,planManualNumberedPreparation,scanManualNumberedWorkday,commitManualPhotoSources,manualSourceNormalizationPending} from './manual-photo-workflow.mjs';
import {createPdfIndexBinding,recognitionSourceFingerprint,canReusePdfIndex,createPhotoInputBinding} from './recognition-provenance.mjs';
import {mustRebuildPhotoPlan,assertWritePlanReady,photoFilesMatchPlan,photoFilesExactlyMatchPlan,trustedPreparedOutputs,retainVerifiedUploadEvidence,assertPhotoFilesMatchPlan} from './photo-plan-gate.mjs';
import {reviewExcludedPhotoNames} from './photo-review-isolation.mjs';
import { ensurePhotoInbox, evaluatePhotoOnlineRecheck, evaluatePhotoOrderClosure, isPdfWorkflowComplete, loadVerifiedPdfWorkflow, markOnlineCompletionVerified, resolveHistoricalPhotoClosureEvidence, resolvePdfBoundPhotoOrderScope, upsertPhotoCompletionBatch, decideManualPhotoResume, decideManualPhotoUncertainRetry, retainManualPhotoAttemptEvidence, restoreUnusedManualUploadRetryCount, retainManualUploadRetryState, reserveManualUploadRetry, markManualUploadRetrySubmitted, manualPhotoUploadProgress } from './workflow-state.mjs';
import { verifyPdf } from './pdf.mjs';
import { cleanupLocalState } from './cleanup.mjs';
import { AutomationApiClient, readEncryptedAutomationCredential } from './automation-auth.mjs';
import {beijingDateToken,buildHistoricalBacklogReport,HISTORICAL_RANGE_START} from './historical-backlog.mjs';
import {reconcileManualUploadedPhotos} from './manual-upload-reconciliation.mjs';
import {uploadManualBatchWithRecovery,needsManualUploadRecovery,manualAttemptFilesVerified,assertManualAttemptResolved} from './manual-upload-attempt.mjs';
import {prepareManualUploadCorrectionReview,approveManualUploadCorrection,markManualUploadCorrectionSubmitted,confirmManualUploadCorrection,retainManualUploadCorrectionState,hasPendingManualUploadCorrection,finalizeManualUploadCorrection} from './manual-upload-correction.mjs';

function parseArgs(argv) { const out = { action: argv[2] }; for (let i=3;i<argv.length;i+=2) out[argv[i].replace(/^--/,'')] = argv[i+1]; return out; }
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=`${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8');
  try { fs.renameSync(tmp,file); }
  catch (error) {
    if (!['EEXIST','EPERM','EACCES'].includes(error.code)) throw error;
    fs.copyFileSync(tmp,file);
    fs.unlinkSync(tmp);
  }
}
function dayFolder(root, date) { const d = new Date(`${date}T00:00:00+08:00`); return path.join(root, `${d.getMonth()+1}月${d.getDate()}日`); }
function nextPaperPath(folder, token, paper) {
  const label = paper === 'red' ? '红纸' : '黄纸';
  const escaped = `${token}${label}`.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern = new RegExp(`^${escaped}(\\d+)\\.pdf$`,'i');
  let maximum = 0;
  for (const name of fs.readdirSync(folder,{withFileTypes:true}).filter((entry)=>entry.isFile()).map((entry)=>entry.name)) {
    const match = name.match(pattern); if (match) maximum = Math.max(maximum,Number(match[1]));
  }
  return path.join(folder,`${token}${label}${maximum+1}.pdf`);
}
function nextWaterPath(folder, token) {
  const base = path.join(folder,`${token}供水.pdf`);
  if (!fs.existsSync(base)) return base;
  const escaped = `${token}供水`.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern = new RegExp(`^${escaped}(\\d+)\\.pdf$`,'i');
  let maximum = 1;
  for (const name of fs.readdirSync(folder,{withFileTypes:true}).filter((entry)=>entry.isFile()).map((entry)=>entry.name)) {
    const match = name.match(pattern); if (match) maximum = Math.max(maximum,Number(match[1]));
  }
  return path.join(folder,`${token}供水${maximum+1}.pdf`);
}
function readJson(file, fallback = null) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : fallback; }
async function copyFileWithRetry(source,destination) {
  let lastError=null;
  for(let attempt=1;attempt<=20;attempt+=1){
    try{fs.copyFileSync(source,destination);return;}
    catch(error){lastError=error;if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt===20)throw error;await new Promise((resolve)=>setTimeout(resolve,300));}
  }
  throw lastError;
}
function rowIdSet(rows) { return new Set(rows.map((row)=>String(row.id))); }
async function queryPdfBoundPhotoUploadState(site, date, scope) {
  if (!scope?.proven) throw new Error('缺少与当前 PDF 哈希绑定的订单 ID 清单，不能自动判定上传结果。');
  const uploaded = await site.queryUploadedOrders(date,{productMode:'all',allStates:true});
  const pending = await site.queryNotUploadedOrders(date,{productMode:'all',allStates:true});
  if (scope.includeTablet) {
    uploaded.push(...await site.queryUploadedTabletPhotoOrders(date));
    pending.push(...await site.queryNotUploadedTabletPhotoOrders(date));
  }
  return resolveBlessingOrderSetUploadState(scope.rows,uploaded,pending);
}
function samePhotoOrderUploadSnapshot(left, right) {
  return Boolean(left && right
    && left.state !== 'ambiguous'
    && right.state !== 'ambiguous'
    && left.expectedOrderIdHash === right.expectedOrderIdHash
    && left.uploadedOrderIdHash === right.uploadedOrderIdHash
    && left.pendingOrderIdHash === right.pendingOrderIdHash);
}
async function verifyOutputs(outputs = []) {
  const verifiedOutputs=[];
  for (const output of outputs) {
    const verified=await verifyPdf(output.file);
    if(verified.sha256!==output.sha256 || verified.pageCount!==output.pageCount || verified.bytes!==output.bytes) throw new Error(`PDF 与原校验凭据不一致：${path.basename(output.file)}`);
    verifiedOutputs.push(verified);
  }
  return verifiedOutputs;
}
async function inspectRenewals(site, runDir, pdfDate) {
  const rows = await site.queryRenewals();
  const manifest = PrayerSite.manifest(rows,pdfDate);
  atomic(path.join(runDir,'renewal-online-current-manifest.json'),manifest);
  atomic(path.join(runDir,'renewal-online-verification.json'),{schemaVersion:2,businessDate:pdfDate,checkedAt:new Date().toISOString(),pendingCount:rows.length,orderIdHash:manifest.orderIdHash,complete:rows.length===0});
  return {rows,manifest};
}
async function autoCompleteRenewalState(site, runDir, pdfDate, timing, log) {
  const stateFile=path.join(runDir,'renewal-state.json');
  const state=readJson(stateFile,null);
  if(!state?.pdfVerified) throw new Error('续费 PDF 尚未校验，禁止自动修改处理状态。');
  if(state.stateChanged){
    log('续费管理：该批续费已是“代理已处理”，跳过重复状态变更。');
    return Number(state.changedCount || 0);
  }
  timing.start('tablet-renewal');
  const result=await site.changeRenewalState(state.orderIdHash);
  timing.end();
  const changed=Number(result.changedCount || 0);
  const remainingRows=Array.isArray(result.remainingRows) ? result.remainingRows : [];
  const terminalUiLabel=String(result.terminalUiLabel || '已处理');
  const dialogMode=String(result.dialogMode || 'unknown');
  const remainingManifest=PrayerSite.manifest(remainingRows,pdfDate);
  state.stateChanged=true;
  state.changedCount=changed;
  state.terminalUiLabel=terminalUiLabel;
  state.dialogMode=dialogMode;
  state.changedAt=new Date().toISOString();
  atomic(stateFile,state);
  atomic(path.join(runDir,'renewal-online-verification.json'),{
    schemaVersion:2,
    businessDate:pdfDate,
    checkedAt:new Date().toISOString(),
    pendingCount:remainingRows.length,
    orderIdHash:remainingManifest.orderIdHash,
    sourceOrderIdHash:state.orderIdHash,
    changedCount:changed,
    terminalUiLabel,
    dialogMode,
    complete:remainingRows.length===0,
  });
  if(remainingRows.length) log(`续费管理：PDF 校验通过后已自动把同一批 ${changed} 条改为“${terminalUiLabel}”；期间新增 ${remainingRows.length} 条未处理续费已保留到下一批。`);
  else log(`续费管理：PDF 校验通过后已自动把同一批 ${changed} 条改为“${terminalUiLabel}”，并复核未处理为 0。`);
  return changed;
}
async function exportRenewals(site, runDir, folder, pdfDate, initialRows, initialManifest, timing, log, { recoverRedPdf=null, recoverYellowPdf=null } = {}) {
  const stateFile=path.join(runDir,'renewal-state.json');
  const receiptFile=path.join(runDir,'renewal-pdf-receipt.json');
  if (!initialRows.length) {
    if (!fs.existsSync(stateFile)) atomic(stateFile,{pdfDate,inspected:true,pdfVerified:true,stateChanged:true,orderCount:0,orderIdHash:initialManifest.orderIdHash,verifiedAt:new Date().toISOString()});
    log('续费管理：未处理为 0，跳过续费 PDF。');
    return;
  }
  const previousReceipt=readJson(receiptFile,null);
  const previousState=readJson(stateFile,null);
  if(previousReceipt) await verifyOutputs(previousReceipt.outputs || []);
  let coveredRows=Array.isArray(previousReceipt?.coveredRows) ? previousReceipt.coveredRows : [];
  if(!coveredRows.length && previousReceipt){
    const legacyManifest=readJson(path.join(runDir,'renewal-manifest.json'),null);
    if(legacyManifest?.orderIdHash===previousReceipt.orderIdHash) coveredRows=legacyManifest.rows || [];
  }
  const coveredIds=rowIdSet(coveredRows);
  const newRows=initialRows.filter((row)=>!coveredIds.has(String(row.id)));
  if(previousReceipt && !newRows.length && previousState?.orderIdHash===initialManifest.orderIdHash && previousState?.pdfVerified){
    log(`续费管理：当前 ${initialRows.length} 条均已有 PDF 凭据，${previousReceipt.outputs.length} 个 PDF 校验通过；继续自动补做“代理已处理”。`);
    await autoCompleteRenewalState(site,runDir,pdfDate,timing,log);
    return;
  }
  if(previousReceipt && newRows.length) log(`续费同日补单：已有 ${coveredRows.length} 条已导出，本次只导出新增 ${newRows.length} 条，红/黄纸编号继续顺延。`);
  timing.start('pdf-export');
  const d=new Date(`${pdfDate}T00:00:00+08:00`); const token=`${d.getMonth()+1}${d.getDate()}`;
  const outputs=[];
  const recoverOutput=async(recoveryFile,destination,label)=>{
    const recovered=await verifyPdf(path.resolve(recoveryFile));
    const existingNames=fs.readdirSync(folder,{withFileTypes:true})
      .filter((entry)=>entry.isFile() && new RegExp(`^${token}${label}\\d+\\.pdf$`,'i').test(entry.name))
      .map((entry)=>path.join(folder,entry.name));
    for(const existingFile of existingNames){
      const existing=await verifyPdf(existingFile);
      if(existing.sha256===recovered.sha256 && existing.bytes===recovered.bytes && existing.pageCount===recovered.pageCount){
        log(`已按哈希认领上次归档的${label}续费 PDF：${path.basename(existingFile)}，不会重复编号或导出。`);
        return existing;
      }
    }
    if(!fs.existsSync(destination)) await copyFileWithRetry(recovered.file,destination);
    const verified=await verifyPdf(destination);
    if(verified.sha256!==recovered.sha256 || verified.bytes!==recovered.bytes || verified.pageCount!==recovered.pageCount) throw new Error(`${label}续费 PDF 接管后哈希不一致。`);
    log(`已接管上次下载但未归档的${label}续费 PDF：${path.basename(destination)}，不会重复点击导出。`);
    return verified;
  };
  const redRows=await site.queryRenewalGroup('长生禄位','长生位模板');
  const newIds=rowIdSet(newRows);
  const newRedRows=redRows.filter((row)=>newIds.has(String(row.id)));
  if(newRedRows.length){const destination=nextPaperPath(folder,token,'red'); const output=recoverRedPdf ? await recoverOutput(recoverRedPdf,destination,'红纸') : await site.exportGroup('tablet-red','0',destination,newRedRows.length,null,newRedRows.map((row)=>String(row.id))); if(output) outputs.push(output);}
  const yellowRows=await site.queryRenewalGroup('往生莲位','往生位模板');
  const newYellowRows=yellowRows.filter((row)=>newIds.has(String(row.id)));
  if(newYellowRows.length){const destination=nextPaperPath(folder,token,'yellow'); const output=recoverYellowPdf ? await recoverOutput(recoverYellowPdf,destination,'黄纸') : await site.exportGroup('tablet-yellow','1',destination,newYellowRows.length,null,newYellowRows.map((row)=>String(row.id))); if(output) outputs.push(output);}
  const grouped=PrayerSite.manifest([...redRows,...yellowRows],pdfDate);
  if(grouped.orderCount!==initialRows.length || grouped.orderIdHash!==initialManifest.orderIdHash) throw new Error('续费红黄分组与初始未处理清单不一致，状态不会改变。');
  timing.end();
  if(!outputs.length) throw new Error('续费有未处理记录，但没有生成续费 PDF。');
  timing.start('pdf-finalize');
  const allOutputs=[...(previousReceipt?.outputs || []),...outputs];
  const allCovered=[...new Map([...coveredRows,...newRows].map((row)=>[String(row.id),row])).values()];
  const receipt={schemaVersion:2,businessDate:pdfDate,orderIdHash:initialManifest.orderIdHash,orderCount:initialRows.length,outputs:allOutputs,coveredRows:allCovered,latestBatch:{orderCount:newRows.length,orderIdHash:PrayerSite.manifest(newRows,pdfDate).orderIdHash,outputs,exportedAt:new Date().toISOString()},verifiedAt:new Date().toISOString()};
  atomic(receiptFile,receipt);
  atomic(path.join(runDir,'renewal-manifest.json'),initialManifest);
  atomic(stateFile,{pdfDate,inspected:true,pdfVerified:true,stateChanged:false,orderIdHash:initialManifest.orderIdHash,orderCount:initialRows.length,verifiedAt:receipt.verifiedAt});
  timing.count('pdf_page_count',outputs.reduce((sum,item)=>sum+item.pageCount,0)); timing.end();
  log(`续费管理：新增 ${newRows.length} 条已导出并校验为 ${outputs.map((item)=>path.basename(item.file)).join('、')}；正在自动把同一批 ${initialRows.length} 条改为“代理已处理”。`);
  await autoCompleteRenewalState(site,runDir,pdfDate,timing,log);
}
const args = parseArgs(process.argv);
const uiLogFile = args['ui-log'] ? path.resolve(args['ui-log']) : null;
function appendUiLog(line) { if (uiLogFile) { fs.mkdirSync(path.dirname(uiLogFile),{recursive:true}); fs.appendFileSync(uiLogFile,`${line}\n`,'utf8'); } }
function log(message) { const line=`[${new Date().toLocaleTimeString('zh-CN',{hour12:false})}] ${message}`; console.log(line); appendUiLog(line); }
function fail(message) { const line=`错误：${message}`; console.error(line); appendUiLog(line); }
function cleanErrorMessage(error) {
  return String(error?.message || error || '未知错误').split(/\r?\n(?:Browser logs:|Call log:)/)[0].trim();
}

const root = path.resolve(args.root || '');
if (!args.action || !root) { fail('缺少运行参数。'); process.exit(2); }
const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// 运行断点、校验凭据、日志和原图备份必须与 NAS 业务目录隔离。
// 祈福运行数据必须跨版本共享、跨电脑隔离；程序父目录可能是同步盘。
const localStateRoot = getMachineLocalStateRoot();
const credentialPath = path.join(localStateRoot, 'secure-login.dat');
const credentialHelperPath = path.join(appRoot, 'ui', 'Read-SecureCredential.ps1');
const automationCredentialPath = path.join(localStateRoot, 'secure-automation.dat');
const automationCredentialHelperPath = path.join(appRoot, 'ui', 'Read-AutomationCredential.ps1');
const workdaysRoot = path.join(localStateRoot, 'workdays');
fs.mkdirSync(workdaysRoot, { recursive:true });
if (args.action === 'automation-auth-check') {
  let credential = null;
  let client = null;
  try {
    credential = readEncryptedAutomationCredential(automationCredentialPath, automationCredentialHelperPath);
    if (!credential) throw new Error('本机尚未配置接口机器认证。');
    client = new AutomationApiClient(credential);
    const status = await client.status();
    const businessDate = String(args['photo-date'] || '').trim();
    if (!businessDate) throw new Error('缺少机器接口日清单业务日期。');
    const plan = await client.dailyPlan(businessDate);
    const groupCounts = Object.fromEntries(Object.entries(plan.groups).map(([name, group])=>[name, group.count]));
    const receipt = {
      schemaVersion:1,businessDate,checkedAt:new Date().toISOString(),
      canonicalVersion:plan.canonicalVersion,canonicalOrderSetSha256:plan.canonicalOrderSetSha256,
      totals:plan.totals,groupCounts,
    };
    const receiptDir = path.join(workdaysRoot,businessDate,'machine-api');
    fs.mkdirSync(receiptDir,{recursive:true});
    atomic(path.join(receiptDir,'daily-plan-check.json'),receipt);
    log('机器接口认证及日清单检查通过；未创建后台人员会话，也未进入验证码页。');
    log(`${businessDate} 机器日清单：常规 ${plan.totals.daily} 条，续费待处理 ${plan.totals.renewal} 条；匿名订单哈希 ${plan.canonicalOrderSetSha256.slice(0,12)}…。`);
  } finally {
    client?.clear();
    if (credential) credential.secret = '';
    credential = null;
  }
  process.exit(0);
}
if (args.action === 'cleanup-local-state') {
  const report = cleanupLocalState(localStateRoot, { force:args['force-cleanup'] === 'yes' });
  if (report.skipped) log('本机空间清理：距离上次清理不足24小时，本次跳过。');
  else log(`本机空间清理完成：删除 ${report.deleted.length} 项，释放 ${(report.deletedBytes / 1048576).toFixed(2)} MB；未完成任务和 NAS 业务文件未触碰。`);
  process.exit(0);
}
const pdfDate = args['pdf-date']; const photoDate = args['photo-date'];
const loginTimeoutMs = Number(args['login-timeout-ms'] || 10 * 60 * 1000);
const siteOptions = { loginTimeoutMs, credentialPath, credentialHelperPath };
if (!photoDate && ['scan','photo-manual-prepare','photo-prepare','photo-recheck','photo-online-recheck','photo-scan','photo-upload','photo-scenes'].includes(args.action)) { fail('缺少照片业务日期。'); process.exit(2); }
if (!pdfDate && ['scan','inspect','export','state-change','renewal-state-change'].includes(args.action)) { fail('缺少 PDF 业务日期。'); process.exit(2); }

if (args.action === 'historical-backlog-check') {
  const asOfDate=beijingDateToken();
  const reportDir=path.join(localStateRoot,'historical-backlog');
  fs.mkdirSync(reportDir,{recursive:true});
  const timing=new Timing(reportDir,'photo-only',asOfDate);
  let site;
  try {
    timing.start('date-resolution');
    log(`正在查询 ${HISTORICAL_RANGE_START} 至 ${asOfDate} 之前的历史未解决业务；北京时间今天的数据明确排除。`);
    timing.end();
    timing.start('order-processing');
    site=new PrayerSite(reportDir,timing,log,siteOptions);
    await site.open();
    const rows=await site.queryHistoricalUnresolved(asOfDate,HISTORICAL_RANGE_START);
    const report=buildHistoricalBacklogReport({asOfDate,...rows});
    atomic(path.join(reportDir,'latest.json'),report);
    timing.end();
    if(report.complete)log('历史线上检查完成：今天以前没有“待祈福”或“祈福中但福单图未上传”的遗留业务。');
    else {
      const dates=report.businessDates.length?`，涉及日期 ${report.businessDates.join('、')}`:'';
      log(`历史线上检查发现 ${report.totalCount} 条未解决业务：待祈福 ${report.pendingPrayerCount} 条，祈福中但福单图未上传 ${report.prayingWithoutPhotoCount} 条${dates}。今天的数据未计入。`);
    }
    await site.close(); site=null;
    timing.finish();
    process.exit(0);
  } catch(error) {
    fail(cleanErrorMessage(error));
    const failedPhase=timing.current?.phase??null;
    try { if(timing.current)timing.end('failed',String(error.message).slice(0,80)); timing.event('blocked',failedPhase,0); } catch {}
    if(site)await site.close().catch(()=>{});
    try { timing.finish(); } catch {}
    process.exit(1);
  }
}

if (args.action === 'scan') {
  const photoDir = path.join(dayFolder(root, photoDate),'1'); const pdfDir = dayFolder(root,pdfDate);
  const images = fs.existsSync(photoDir) ? fs.readdirSync(photoDir).filter((x)=>/\.(jpe?g|png)$/i.test(x)) : [];
  const pdfs = fs.existsSync(pdfDir) ? fs.readdirSync(pdfDir).filter((x)=>/\.pdf$/i.test(x)) : [];
  log(`照片目录：${photoDir}`); log(`发现照片 ${images.length} 张。`); log(`PDF目录：${pdfDir}`); log(`发现 PDF ${pdfs.length} 个。`);
  if (pdfs.length) log(`检测到当天已有 PDF，PDF 导出工作视为已处理：${pdfs.sort((a,b)=>a.localeCompare(b,'zh-CN')).join('、')}`);
  else log('当天尚无 PDF，可以执行导出。');
  process.exit(0);
}

if (args.action === 'reconcile-manual-photo-closure') {
  const dayRunDir = path.join(workdaysRoot,photoDate);
  const photoRunDir = path.join(dayRunDir,'photos');
  const manifestFile = path.join(photoRunDir,'photo-manifest.json');
  const historicalManifestFile = path.join(dayRunDir,'order-manifest.json');
  const verificationFile = path.join(dayRunDir,'online-verification.json');
  if (!fs.existsSync(manifestFile) || !fs.existsSync(verificationFile)) throw new Error('缺少照片清单或平台只读验证凭据，不能补记闭环。');
  const manifest = JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  const historicalManifest = fs.existsSync(historicalManifestFile) ? JSON.parse(fs.readFileSync(historicalManifestFile,'utf8')) : null;
  const verification = JSON.parse(fs.readFileSync(verificationFile,'utf8'));
  const closureEvidence = resolveHistoricalPhotoClosureEvidence({ historicalManifest, manifest });
  assertUnchangedManifest(manifest);
  const verificationAgeMs = Date.now() - Date.parse(verification.checkedAt || '');
  if (verification.businessDate !== photoDate || verification.complete !== true || Number(verification.blessingPendingCount) !== 0 || Number(verification.tabletPendingCount) !== 0 || Number(verification.localPdfCount) < 1) throw new Error('平台验证尚不能证明该日期全部待办为 0，不能补记闭环。');
  if (!Number.isFinite(verificationAgeMs) || verificationAgeMs < 0 || verificationAgeMs > 30 * 60 * 1000) throw new Error('平台只读验证已超过 30 分钟，请先重新检测 PDF。');
  if (!closureEvidence.proven) throw new Error('缺少历史订单清单或完整的旧版 PDF/照片对应凭据，不能把无订单日期误记为人工闭环。');
  const reconciledAt = new Date().toISOString();
  const uploadedFiles = Object.fromEntries(manifest.files.blessing.map((file) => {
    const name = path.basename(file);
    return [name,{sha256:manifest.fileHashes[name],uploadedAt:reconciledAt,evidence:'manual-online-closure-reconciled'}];
  }));
  atomic(path.join(photoRunDir,'photo-upload-receipt.json'),{
    schemaVersion:3,businessDate:photoDate,fileSetHash:manifest.fileSetHash,
    expectedBlessingCount:manifest.counts.pdfPages,missingBlessingCount:manifest.counts.missingBlessing,
    complete:true,batchCompleteReady:true,onlineClosureCheckReady:true,
    uploadedCount:manifest.counts.blessing,uploadedFiles,stage:'manual-online-closure-reconciled',
    onlineMatchedOrderCount:closureEvidence.historicalOrderCount,manualBusinessCompletionDetected:true,
    closureEvidenceSource:closureEvidence.source,legacyPdfPageCount:closureEvidence.legacyPdfPageCount,
    reconciledAt,completedAt:reconciledAt,batches:[],
  });
  atomic(path.join(photoRunDir,'scene-upload-receipt.json'),{
    schemaVersion:3,businessDate:photoDate,fileSetHash:manifest.fileSetHash,
    complete:true,partialComplete:false,stage:'manual-online-closure-reconciled',tabletCompletionVerified:true,
    regularCompletedOrderCount:0,tabletCompletedOrderCount:0,completedOrderCount:0,
    historicalOrderCount:closureEvidence.historicalOrderCount,manualBusinessCompletionDetected:true,
    closureEvidenceSource:closureEvidence.source,legacyPdfPageCount:closureEvidence.legacyPdfPageCount,
    reconciledAt,completedAt:reconciledAt,
  });
  const closureLabel = closureEvidence.source === 'historical-order-manifest'
    ? `历史清单有 ${closureEvidence.historicalOrderCount} 条订单`
    : `旧版完整 PDF/照片对应凭据有 ${closureEvidence.legacyPdfPageCount} 页`;
  log(`纯本地补记完成：平台只读凭据确认供灯与牌位待办均为 0，${closureLabel}；${photoDate} 已记为人工闭环。未连接上传入口，未修改平台。`);
  process.exit(0);
}

if (args.action === 'photo-online-recheck') {
  const photoRunDir = path.join(workdaysRoot,photoDate,'photos');
  fs.mkdirSync(photoRunDir,{recursive:true});
  const photoTiming = new Timing(photoRunDir,'photo-only',photoDate);
  let photoSite;
  try {
    photoTiming.start('date-resolution');
    log(`历史照片业务日期：${photoDate}。本轮先只读复核线上闭环状态，不上传图片、不修改订单。`);
    photoTiming.end();
    const manifestFile = path.join(photoRunDir,'photo-manifest.json');
    const historicalManifestFile = path.join(workdaysRoot,photoDate,'order-manifest.json');
    const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile,'utf8')) : null;
    const historicalManifest = fs.existsSync(historicalManifestFile) ? JSON.parse(fs.readFileSync(historicalManifestFile,'utf8')) : null;
    const closureEvidence = resolveHistoricalPhotoClosureEvidence({historicalManifest,manifest});
    photoTiming.start('order-processing');
    photoSite = new PrayerSite(photoRunDir,photoTiming,log,siteOptions);
    await photoSite.open();
    const uploaded = await photoSite.queryUploadedOrders(photoDate,{productMode:'all',allStates:true});
    const notUploaded = await photoSite.queryNotUploadedOrders(photoDate,{productMode:'all',allStates:true});
    const uploadedTablet = await photoSite.queryUploadedTabletPhotoOrders(photoDate);
    const notUploadedTablet = await photoSite.queryNotUploadedTabletPhotoOrders(photoDate);
    const onlineRows = [...uploaded,...notUploaded,...uploadedTablet,...notUploadedTablet];
    const historicalIds = new Set((historicalManifest?.rows || []).map((row) => String(row.id)));
    const matchedHistoricalCount = new Set(onlineRows.filter((row) => historicalIds.has(String(row.id))).map((row) => String(row.id))).size;
    const onlineUnfinishedCount = onlineRows.filter((row) => !/^(已完成|祈福完成|已祈福)$/.test(String(row.status || '').trim())).length;
    const pendingRegular = await photoSite.queryLamp(photoDate);
    const pendingTablet = await photoSite.queryDailyTablet(photoDate);
    const result = evaluatePhotoOnlineRecheck({
      onlineUploadedCount:uploaded.length+uploadedTablet.length,
      onlineNotUploadedCount:notUploaded.length+notUploadedTablet.length,
      pendingRegularCount:pendingRegular.length,
      pendingTabletCount:pendingTablet.length,
      historicalEvidenceProven:closureEvidence.proven && (!historicalIds.size || matchedHistoricalCount === historicalIds.size),
      onlineScopeCount:new Set(onlineRows.map((row) => String(row.id))).size,
      onlineUnfinishedCount,
    });
    const checkedAt = new Date().toISOString();
    atomic(path.join(photoRunDir,'photo-online-closure.json'),{
      schemaVersion:1,
      businessDate:photoDate,
      checkedAt,
      ...result,
      closureEvidenceSource:closureEvidence.source,
      historicalOrderCount:closureEvidence.historicalOrderCount,
      matchedHistoricalCount,
      legacyPdfPageCount:closureEvidence.legacyPdfPageCount,
      readOnly:true,
      platformModified:false,
    });
    photoTiming.end();
    if (result.complete) {
      log(`线上闭环复核通过：${photoDate} 的福单未上传 0 条、供灯待祈福 0 条、牌位待祈福 0 条；已写入本机终态回执，以后不再因旧的部分回执误报。平台未作任何修改。`);
    } else if (!result.historicalEvidenceProven) {
      log(`线上订单与本机历史清单未完整对应：原清单 ${historicalIds.size} 条、当前匹配 ${matchedHistoricalCount} 条；不能确认 ${photoDate} 已闭环。未修改平台。`);
    } else {
      log(`线上尚未闭环：祈福状态未完成 ${result.onlineUnfinishedCount ?? '未知'} 条、福单未上传 ${result.onlineNotUploadedCount} 条、供灯待祈福 ${result.pendingRegularCount} 条、牌位待祈福 ${result.pendingTabletCount} 条；只读复核未修改平台。`);
    }
    await photoSite.close();
    photoSite = null;
    photoTiming.finish();
    process.exit(0);
  } catch (error) {
    fail(cleanErrorMessage(error));
    const failedPhase = photoTiming.current?.phase ?? null;
    try { if (photoTiming.current) photoTiming.end('failed',String(error.message).slice(0,80)); photoTiming.event('blocked',failedPhase,0); } catch {}
    if (photoSite) await photoSite.close().catch(()=>{});
    try { photoTiming.finish(); } catch {}
    process.exit(1);
  }
}

if (args.action === 'photo-manual-prepare' || args.action === 'photo-prepare' || args.action === 'photo-recheck' || args.action === 'photo-scan' || args.action === 'photo-upload' || args.action === 'photo-scenes') {
  const photoRunDir = path.join(workdaysRoot,photoDate,'photos');
  fs.mkdirSync(photoRunDir, { recursive:true });
  const photoTiming = new Timing(photoRunDir,'photo-only',photoDate);
  let photoSite;
  try {
    photoTiming.start('date-resolution');
    log(`照片业务日期：${photoDate}。只处理该日期目录，不自动关联 PDF 业务日期。`);
    photoTiming.end();
    const manualNumberedMode=!['photo-prepare','photo-recheck'].includes(args.action);
    const mirror=manualNumberedMode?ensureManualPhotoMirror({root,date:photoDate,workDir:photoRunDir}):null;
    const activePhotoRoot=mirror?.root||root;
    if(mirror)log(`人工编号照片使用本机工作副本${mirror.reused?'（已复用）':''}；压缩成品将核验后保存回原目录。来源：${mirror.sourcePhotoDir}`);
    if(args.action==='photo-manual-prepare') {
      if(args.authorized!=='yes')throw Error('人工编号照片规格处理会修改照片目录，缺少本次按钮授权。');
      const photoDir=path.join(photoDayFolder(activePhotoRoot,photoDate),'1');
      photoTiming.start('photo-manual-prepare');
      const plan=await planManualNumberedPreparation({photoDir,date:photoDate});
      atomic(path.join(photoRunDir,'photo-manual-prepare-plan.json'),plan);
      photoTiming.setCount('photo_count',plan.photoInputBinding.files.length);
      photoTiming.setCount('pdf_page_count',0);
      if(!plan.safeToApply) {
        for(const issue of plan.issues)log(`需人工处理：${issue}`);
        throw Error('人工编号照片检查未通过；未压缩、未打开后台、未上传。');
      }
      if(plan.assignments.length) {
        const receipt=await applyPhotoPreparation(plan,photoRunDir);
        atomic(path.join(photoRunDir,'photo-prepare-receipt.json'),receipt);
        log(`人工编号照片规格处理完成：本机上传副本 ${receipt.processedCount} 张已统一为 1800×1350、JPG、且不超过 1.5 MiB；正在核验并保存回原目录。`);
      } else log('本机上传副本已经符合规格；继续核对原目录是否也已完成压缩。');
      const sourceReceipt=await commitManualPhotoSources({mirror,date:photoDate,workDir:photoRunDir});
      log(`原目录照片压缩已核验：保存 ${sourceReceipt.processedCount} 张，${sourceReceipt.files.length} 张与上传副本哈希一致；尺寸 1800×1350、JPG、不超过 1.5 MiB；原图备份保存在本机。`);
      photoTiming.end();
    }
    if (args.action === 'photo-prepare' || args.action === 'photo-recheck') {
      const readOnlyRecheck = args.action === 'photo-recheck';
      if (!readOnlyRecheck && args.authorized !== 'yes') throw new Error('自动处理和编号会修改照片目录，缺少本次按钮授权。');
      const [year, month, day] = photoDate.split('-').map(Number);
      const folder = path.join(root, `${month}月${day}日`);
      const photoDir = path.join(folder, '1');
      photoTiming.start('photo-match');
      const imageFiles=fs.readdirSync(photoDir).filter((name)=>/\.(?:jpe?g|png)$/i.test(name)).map(name=>path.join(photoDir,name));
      const currentPhotoBinding=createPhotoInputBinding(photoDir,imageFiles);
      const currentPdfFiles=fs.readdirSync(folder).filter(name=>/\.pdf$/i.test(name)).map(name=>path.join(folder,name));
      const currentPdfBinding=createPdfIndexBinding(photoDate,currentPdfFiles,recognitionSourceFingerprint(appRoot));
      const operationalPlanFile=path.join(photoRunDir,'photo-prepare-plan.json');
      const preparationReceiptFile=path.join(photoRunDir,'photo-prepare-receipt.json');
      const previousPlan=readJson(operationalPlanFile,null);
      const previousPreparationReceipt=readJson(preparationReceiptFile,null);
      const previousIndexReusable=canReusePdfIndex(previousPlan,currentPdfBinding);
      const exactPreparedCheckpoint=!readOnlyRecheck&&previousIndexReusable
        &&previousPlan?.safeToApply===true&&!(previousPlan.issues||[]).length
        &&photoFilesExactlyMatchPlan(previousPlan,previousPreparationReceipt,currentPhotoBinding.files);
      if(exactPreparedCheckpoint) {
        photoTiming.setCount('photo_count',imageFiles.length);
        photoTiming.setCount('pdf_page_count',previousPlan.pdfPages.length);
        photoTiming.count('manual_review_count',(previousPlan.pendingIssues||[]).length);
        photoTiming.count('pending_photo_count',(previousPlan.missingExpected||[]).length);
        photoTiming.end();
        log(`照片、PDF 与已完成处理凭据完全一致：保留 ${previousPlan.allowedBlessingNumbers.length} 张已确认福单的编号结论，跳过重复 OCR；断点不会因再次点击而倒退。`);
      } else {
        const trustedPreparedFiles=!readOnlyRecheck&&previousIndexReusable
          ?trustedPreparedOutputs(previousPlan,previousPreparationReceipt,currentPhotoBinding.files):[];
        const plan = await planPhotoPreparation({
          appRoot,
          folder,
          photoDir,
          date:photoDate,
          expectedPrefix:`${String(year).slice(-2)}${month}`,
          workDir:photoRunDir,
          onProgress:(message)=>log(message),
          trustedPreparedFiles,
        });
        // A diagnostic recheck is intentionally isolated from the operational
        // plan.  A weaker OCR retry may report doubts, but it cannot revoke a
        // previously committed preparation checkpoint.
        atomic(path.join(photoRunDir,readOnlyRecheck?'photo-recheck-plan.json':'photo-prepare-plan.json'),plan);
        const manualReviewFile = path.join(photoRunDir,'photo-manual-review.json');
        if (!readOnlyRecheck && (plan.pendingIssues || []).length) {
          atomic(manualReviewFile,{
            schemaVersion:1,
            businessDate:photoDate,
            createdAt:new Date().toISOString(),
            pendingIssues:plan.pendingIssues,
            missingExpected:plan.missingExpected,
            manualReview:plan.manualReview || {},
            nextStep:'已确定编号的福单会继续上传；未识别但无复核冲突的照片仍会统一像素和体积，人工补录编号后再次点击照片主按钮。',
          });
        } else if (!readOnlyRecheck && fs.existsSync(manualReviewFile)) fs.rmSync(manualReviewFile,{force:true});
        photoTiming.setCount('photo_count',imageFiles.length);
        photoTiming.setCount('pdf_page_count',plan.pdfPages.length);
        photoTiming.count('digit_direct_count',plan.assignments.filter((item)=>item.evidence?.method === 'pdf-range-and-photo-code').length);
        photoTiming.count('text_resolved_count',plan.assignments.filter((item)=>String(item.evidence?.method || '').includes('photo-code')).length);
        photoTiming.count('fingerprint_fallback_count',plan.assignments.filter((item)=>
          String(item.evidence?.method || '').includes('local-pdf-page-shape-fingerprint')
          || String(item.evidence?.pdfRecheck?.method || '').includes('fingerprint')).length);
        photoTiming.count('duplicate_validation_count',plan.duplicateSources.length);
        photoTiming.count('manual_review_count',(plan.pendingIssues || []).length);
        photoTiming.count('pending_photo_count',plan.missingExpected.length);
        photoTiming.end();
        if (plan.localPageMatch?.attempted) {
          log(`本地 PDF 页面版式复核：尝试 ${plan.localPageMatch.attempted} 张，唯一确认 ${plan.localPageMatch.resolved} 张，仍未决 ${plan.localPageMatch.unresolved} 张。未使用 API 或网络。`);
        }
        if (plan.pdfClaimRecheck?.attempted) {
          log(`编号双证据复核：检查 ${plan.pdfClaimRecheck.attempted} 张，确认 ${plan.pdfClaimRecheck.confirmed} 张，冲突 ${plan.pdfClaimRecheck.rejected} 张，纸面暂不可读 ${plan.pdfClaimRecheck.inconclusive || 0} 张。`);
        }
        log(`自动编号方案：PDF ${plan.pdfPages.length} 页，福单编号 ${plan.assignments.filter((item)=>item.kind === 'blessing').length} 张，场景图 ${plan.assignments.filter((item)=>item.kind.startsWith('scene-')).length} 张。`);
        if (readOnlyRecheck) {
          for (const issue of plan.issues || []) log(`复核发现：${issue}`);
          for (const issue of plan.pendingIssues || []) log(`复核待人工确认：${issue}`);
          log(`只读编号复核完成：检查 ${plan.pdfClaimRecheck?.attempted || 0} 张，确认 ${plan.pdfClaimRecheck?.confirmed || 0} 张，冲突 ${plan.pdfClaimRecheck?.rejected || 0} 张，纸面暂不可读 ${plan.pdfClaimRecheck?.inconclusive || 0} 张。没有改名、压缩、上传或修改平台；正式处理计划和上传凭据均未覆盖。`);
          photoTiming.finish();
          process.exit(0);
        }
        if (!plan.safeToApply) {
          for (const issue of plan.issues) log(`需人工处理：${issue}`);
          throw new Error('自动处理方案未通过一一对应校验，NAS 照片没有被修改。');
        }
        for (const issue of plan.pendingIssues || []) log(`待人工处理（不阻断已确认照片）：${issue}`);
        if (plan.assignments.length || plan.unresolvedStandardizations?.length) {
          photoTiming.start('photoshop');
          const receipt = await applyPhotoPreparation(plan,photoRunDir);
          atomic(preparationReceiptFile,receipt);
          photoTiming.end();
          log(`自动处理和编号完成：福单图 ${receipt.blessingCount} 张，供灯场景图 ${receipt.lampSceneCount} 张，供水场景图 ${receipt.waterSceneCount} 张，未识别但已统一规格 ${receipt.unresolvedStandardizedCount || 0} 张；原图备份已保存。${plan.missingExpected.length ? ` 仍有 ${plan.missingExpected.length} 个 PDF 编号待匹配，请核对未识别原图；这些照片不会猜号或上传。` : ''}`);
        } else {
          log('照片已经是规范名称，本次没有重复处理或重复改名。');
        }
      }
    }
    photoTiming.start(manualNumberedMode?'photo-manual-scan':'pdf-index');
    const photoInbox = path.join(photoDayFolder(activePhotoRoot, photoDate), '1');
    const photoFileNames = fs.existsSync(photoInbox)
      ? fs.readdirSync(photoInbox).filter((name) => /\.(?:jpe?g|png)$/i.test(name)) : [];
    const currentPhotoInputBinding=createPhotoInputBinding(photoInbox,photoFileNames.map(name=>path.join(photoInbox,name)));
    const quickImageCount = photoFileNames.length;
    let manifest;
    if(manualNumberedMode) {
      log(`人工编号模式：发现 ${quickImageCount} 张图片；不运行 OCR，不读取或比对 PDF。`);
      manifest=await scanManualNumberedWorkday(activePhotoRoot,photoDate);
      if(['photo-upload','photo-scenes'].includes(args.action)&&manifest.normalizationReady) {
        if(args.authorized!=='yes')throw Error('原目录压缩保存缺少本次按钮授权。');
        const sourceReceipt=await commitManualPhotoSources({mirror,date:photoDate,workDir:photoRunDir});
        log(`上传前原目录压缩核验通过：保存 ${sourceReceipt.processedCount} 张；原目录与上传副本一致。`);
      }
      manifest.sourcePhotoDir=mirror.sourcePhotoDir;
      manifest.sourceInputFileHashes=mirror.sourceFileHashes;
      manifest.localMirror=true;
      manifest.mirrorIdentity=mirror.identity;
      manifest.sourceNormalizationPending=manualSourceNormalizationPending(mirror,photoDate);
    } else {
      log(`照片目录快速清点：发现 ${quickImageCount} 张图片。初始化预检不读取未编号原图做 OCR；正式识别和编号由照片处理阶段完成。`);
      const cachedPlanFile = path.join(photoRunDir,'photo-prepare-plan.json');
      let cachedPhotoPlan = readJson(cachedPlanFile,null);
      const bindingFolder = photoDayFolder(root,photoDate);
      const currentPdfFiles = fs.existsSync(bindingFolder) ? fs.readdirSync(bindingFolder)
        .filter(name=>/\.pdf$/i.test(name)).map(name=>path.join(bindingFolder,name)) : [];
      const currentPdfBinding = createPdfIndexBinding(photoDate,currentPdfFiles,recognitionSourceFingerprint(appRoot));
      const indexReusable = canReusePdfIndex(cachedPhotoPlan,currentPdfBinding);
      const writePhotoAction = ['photo-upload','photo-scenes'].includes(args.action);
      const preparationReceipt = writePhotoAction ? readJson(path.join(photoRunDir,'photo-prepare-receipt.json'),null) : null;
      const photoIdentityMatches = !writePhotoAction || photoFilesMatchPlan(cachedPhotoPlan,preparationReceipt,currentPhotoInputBinding.files);
      let allowedBlessingNumbers = indexReusable && photoIdentityMatches && Array.isArray(cachedPhotoPlan?.allowedBlessingNumbers)
        ? new Set(cachedPhotoPlan.allowedBlessingNumbers.map(Number).filter(Number.isInteger)):null;
      const standardizedOnly = fs.existsSync(photoInbox) && fs.readdirSync(photoInbox)
        .filter((name) => /\.(?:jpe?g|png)$/i.test(name))
        .every((name) => /^\d+$/.test(path.parse(name).name) || /^2\.[1256]$/.test(path.parse(name).name));
      if (mustRebuildPhotoPlan({indexReusable:allowedBlessingNumbers!==null,standardizedOnly,imageCount:quickImageCount,action:args.action})) {
        const [year, month, day] = photoDate.split('-').map(Number);
        cachedPhotoPlan = await planPhotoPreparation({appRoot,folder:path.join(root,`${month}月${day}日`),photoDir:photoInbox,date:photoDate,
          expectedPrefix:`${String(year).slice(-2)}${month}`,workDir:photoRunDir,onProgress:(message)=>log(message)});
        atomic(cachedPlanFile,cachedPhotoPlan);
        allowedBlessingNumbers = new Set((cachedPhotoPlan.allowedBlessingNumbers || []).map(Number).filter(Number.isInteger));
      }
      assertWritePlanReady(cachedPhotoPlan,{imageCount:quickImageCount,action:args.action});
      let expectedNumberModes=null;
      if(allowedBlessingNumbers&&Array.isArray(cachedPhotoPlan?.pdfPages)) {
        const indexedModes=new Map();let complete=true;
        for(const page of cachedPhotoPlan.pdfPages) {
          const number=Number(page.number);
          if(!Number.isInteger(number)||!allowedBlessingNumbers.has(number))continue;
          const pdfName=String(page.pdfName||path.basename(page.pdf||''));
          const mode = /供水/.test(pdfName) ? 'water' : page.portrait ? 'tablet' : 'lamp';
          if(indexedModes.has(number)&&indexedModes.get(number)!==mode)complete=false;
          indexedModes.set(number,mode);
        }
        if([...allowedBlessingNumbers].some(number=>!indexedModes.has(number)))complete=false;
        if(complete)expectedNumberModes=indexedModes;
      }
      const excludedPhotoNames=reviewExcludedPhotoNames(cachedPhotoPlan);
      manifest=await scanPhotoWorkday(root,photoDate,photoRunDir,{runOcr:false,expectedNumbers:allowedBlessingNumbers,expectedNumberModes,excludedPhotoNames});
      if(writePhotoAction&&quickImageCount>0) assertPhotoFilesMatchPlan(cachedPhotoPlan,preparationReceipt,
        Object.entries(manifest.fileHashes||{}).map(([name,sha256])=>({name,sha256})));
    }
    photoTiming.setCount('photo_count',manifest.counts.allImages);
    photoTiming.setCount('pdf_page_count',manifest.counts.pdfPages);
    photoTiming.count('manual_review_count',manifest.counts.unexpected);
    atomic(path.join(photoRunDir,'photo-manifest.json'),manifest);
    photoTiming.end();
    log(manifest.manualNumberedMode
      ? `人工编号清单：可上传福单图 ${manifest.counts.blessing} 张，供灯场景图 ${manifest.counts.lampScene} 张，供水场景图 ${manifest.counts.waterScene} 张；未读取 PDF。`
      : `发现本日可上传福单图 ${manifest.counts.blessing} 张，供灯场景图 ${manifest.counts.lampScene} 张，供水场景图 ${manifest.counts.waterScene} 张，PDF ${manifest.counts.pdfPages} 页。${manifest.counts.foreignBlessing ? ` 已隔离跨日/范围外纯数字照片 ${manifest.counts.foreignBlessing} 张。` : ''}`);
    if (manifest.warnings.length) {
      log(`规格/待核对提醒 ${manifest.warnings.length} 项，已写入照片清单。`);
      for (const message of manifest.warnings) log(`提醒：${message}`);
    }
    if (manifest.ocrSuggestions.length) {
      const suggested = manifest.ocrSuggestions.filter((item)=>item.suggestedTarget).length;
      log(`未规范命名图片 ${manifest.counts.unexpected} 张；本地 OCR 给出 ${suggested} 个仅供复核的编号建议，不会自动改名。`);
    }
    const blockingErrors = Array.isArray(manifest.blockingErrors) ? manifest.blockingErrors : manifest.errors;
    const manualIssues = Array.isArray(manifest.manualIssues) ? manifest.manualIssues : [];
    if (manualIssues.length) {
      for (const message of manualIssues) log(`待人工处理（已确认照片继续）：${message}`);
    }
    if (blockingErrors.length) {
      for (const message of blockingErrors) log(`硬性阻断：${message}`);
      if (args.action === 'photo-manual-prepare' || args.action === 'photo-upload' || args.action === 'photo-scenes') throw new Error('人工编号照片的安全预检未通过，未打开上传页面。');
      log('照片预检完成：没有可安全上传的福单图。处理硬性问题后重新预检。');
    } else {
      log(manifest.manualNumberedMode ? '人工编号照片预检通过：文件名和上传规格均合格，未读取 PDF。' : manifest.counts.missingBlessing > 0
        ? `照片增量预检通过：现有 ${manifest.counts.blessing} 张可先上传；${manifest.photoAvailability.summary}。`
        : '照片预检通过：编号命名、PDF页数、重复项和图片硬性规格均通过。');
    }
    if (args.action === 'photo-upload') {
      if (args.authorized !== 'yes') throw new Error('上传缺少用户授权。');
      assertUnchangedManifest(manifest);
      const receiptFile = path.join(photoRunDir,'photo-upload-receipt.json');
      let needsOnlineRetryCheck = false;
      let previous = null;
      const uploadedFiles = {};
      if (fs.existsSync(receiptFile)) {
        previous = JSON.parse(fs.readFileSync(receiptFile,'utf8'));
        if (previous.uploadedFiles && typeof previous.uploadedFiles === 'object') {
          // Upload success is monotonic evidence.  A later OCR/review pass may
          // temporarily exclude the file from the manifest, but it cannot
          // revoke a prior upload while the exact bytes still exist on disk.
          Object.assign(uploadedFiles,retainVerifiedUploadEvidence(previous.uploadedFiles,currentPhotoInputBinding.files));
        } else if (previous.complete) {
          const provenNames = new Set();
          if (previous.fileSetHash === manifest.fileSetHash && Number(previous.uploadedCount) === manifest.counts.blessing) {
            for (const file of manifest.files.blessing) provenNames.add(path.basename(file));
          } else {
            for (const batch of previous.batches || []) {
              const names = Array.isArray(batch?.files) ? batch.files : [];
              if (Number(batch?.uploadedCount) === names.length) for (const name of names) provenNames.add(name);
            }
          }
          for (const name of provenNames) {
            if (manifest.fileHashes?.[name]) uploadedFiles[name] = {sha256:manifest.fileHashes[name],uploadedAt:previous.completedAt || previous.startedAt,evidence:'migrated-receipt'};
          }
        }
        if ((previous.fileSetHash === manifest.fileSetHash && !previous.complete)
            || (manifest.manualNumberedMode && needsManualUploadRecovery(previous))) {
          const untouched = Number(previous.uploadedCount || 0) === 0 && (!Array.isArray(previous.batches) || previous.batches.length === 0);
          needsOnlineRetryCheck = true;
          log(untouched
            ? `检测到上次福单图上传中断（阶段：${previous.stage || '旧版未记录'}）；将先查询线上“福单已上传”状态，再决定是否允许重试。`
            : `检测到上次在 ${previous.stage || '未知阶段'} 中断，当前可复用 ${Object.keys(uploadedFiles).length} 张回执；将先只读核对线上状态，不会盲目重传。`);
        }
      }
      let pendingFiles = manifest.files.blessing.filter((file) => uploadedFiles[path.basename(file)]?.sha256 !== manifest.fileHashes?.[path.basename(file)]);
      let verifiedCurrentBlessingCount = manifest.files.blessing.length - pendingFiles.length;
      const isSupplementRun = previous?.complete === true && Object.keys(uploadedFiles).length > 0 && pendingFiles.length > 0;
      let batches = splitUploadBatches(pendingFiles);
      const receipt = {
        schemaVersion:3,
        businessDate:photoDate,
        fileSetHash:manifest.fileSetHash,
        expectedBlessingCount:manifest.manualNumberedMode?manifest.counts.blessing:manifest.counts.pdfPages,
        missingBlessingCount:manifest.counts.missingBlessing,
        startedAt:previous?.startedAt || new Date().toISOString(),
        resumedAt:previous ? new Date().toISOString() : null,
        complete:false,
        batchCompleteReady:false,
        onlineClosureCheckReady:previous?.onlineClosureCheckReady === true || (isSupplementRun && manifest.counts.missingBlessing > 0),
        uploadedCount:Object.keys(uploadedFiles).length,
        uploadedFiles,
        batches:Array.isArray(previous?.batches) ? previous.batches : [],
        uncertainSubmission:previous?.uncertainSubmission === true,
        uncertainRetryCount:(previous?.fileSetHash === manifest.fileSetHash || (manifest.manualNumberedMode && needsManualUploadRecovery(previous))) ? restoreUnusedManualUploadRetryCount(previous) : 0,
        previousAttempt:retainManualPhotoAttemptEvidence(previous),
        ...(manifest.manualNumberedMode && needsManualUploadRecovery(previous)
          ? retainManualUploadRetryState(previous) : {}),
        ...retainManualUploadCorrectionState(previous),
        stage:'not-started'
      };
      if (manifest.manualNumberedMode && manualAttemptFilesVerified(receipt,manifest.fileHashes)) {
        receipt.uncertainSubmission=false;
      }
      if (!pendingFiles.length) {
        if (manifest.manualNumberedMode) assertManualAttemptResolved(receipt,manifest.fileHashes);
        finalizeManualUploadCorrection(receipt);
        receipt.complete = true;
        receipt.batchCompleteReady = manifest.batchCompleteReady === true;
        receipt.stage = manifest.batchCompleteReady ? 'complete' : 'available-files-complete-waiting-for-supplement';
        receipt.completedAt = new Date().toISOString();
        atomic(receiptFile,receipt);
        log(manifest.counts.missingBlessing > 0
          ? `现有 ${receipt.uploadedCount} 张福单图均已有上传凭据；${manifest.photoAvailability.summary}。本次没有重复上传。`
          : `相同图片集合已经完成上传，共 ${receipt.uploadedCount} 张；本次不会重复提交。`);
        photoTiming.finish();
        process.exit(0);
      }
      atomic(receiptFile,receipt);
      photoTiming.start('upload');
      photoSite = new PrayerSite(photoRunDir,photoTiming,log,siteOptions);
      await photoSite.open();
      const pdfReceipt = manifest.manualNumberedMode?null:readJson(path.join(workdaysRoot,photoDate,'pdf-receipt.json'),null);
      const uploadOrderScope = manifest.manualNumberedMode
        ? {proven:false,reason:'manual-numbered-mode-no-pdf'}
        : resolvePdfBoundPhotoOrderScope({businessDate:photoDate,photoManifest:manifest,pdfReceipt});
      let latestOrderState = null;
      let manualResume = null;
      let allowOneTimeRetry = false;
      let uploadCorrectionId = null;
      const queryManualUploadState = async () => {
        const uploadedLamp=await photoSite.queryUploadedOrders(photoDate,{productMode:'all',allStates:true});
        const pendingLamp=await photoSite.queryNotUploadedOrders(photoDate,{productMode:'all',allStates:true});
        const uploadedTablet=await photoSite.queryUploadedTabletPhotoOrders(photoDate);
        const pendingTablet=await photoSite.queryNotUploadedTabletPhotoOrders(photoDate);
        return {uploadedCount:uploadedLamp.length+uploadedTablet.length,
          pendingRows:[...pendingLamp.map((row)=>({...row,kind:'lamp'})),
            ...pendingTablet.map((row)=>({...row,kind:'tablet'}))]};
      };
      const orderStateEvidence = (state) => ({
        state:state.state,
        expectedCount:state.expectedCount,
        uploadedCount:state.uploadedCount,
        pendingCount:state.pendingCount,
        conflictCount:state.conflictCount,
        expectedOrderIdHash:state.expectedOrderIdHash,
        uploadedOrderIdHash:state.uploadedOrderIdHash,
        pendingOrderIdHash:state.pendingOrderIdHash,
      });
      const markAllAvailableFilesUploaded = (evidence, at = new Date().toISOString()) => {
        for (const file of manifest.files.blessing) {
          const name = path.basename(file);
          receipt.uploadedFiles[name] = {sha256:manifest.fileHashes[name],uploadedAt:at,evidence};
        }
        receipt.uploadedCount = manifest.counts.blessing;
      };
      const persistReadbackMatch = async (item) => {
        if (!manifest.fileHashes[item.name] || item.sha256 !== manifest.fileHashes[item.name]) {
          throw new Error('线上图片核对返回了清单外或哈希不一致的文件，已停止。');
        }
        receipt.uploadedFiles[item.name] = {
          sha256:item.sha256,uploadedAt:new Date().toISOString(),evidence:'online-image-readback',
          onlineOrderIdHash:item.onlineOrderIdHash,onlineImageSha256:item.onlineImageSha256,
          minimumDetailSeparation:item.minimumDetailSeparation,
        };
        receipt.uploadedCount=manifest.files.blessing.filter(file=>
          receipt.uploadedFiles[path.basename(file)]?.sha256 === manifest.fileHashes[path.basename(file)]).length;
        if (manualAttemptFilesVerified(receipt,manifest.fileHashes)) {
          receipt.uncertainSubmission=false;
          receipt.currentBatchReconciledAt=new Date().toISOString();
        }
        // A later failed download or process exit cannot erase files already proved online.
        atomic(receiptFile,receipt);
      };
      if (needsOnlineRetryCheck) {
        const historicalManifestFile = path.join(workdaysRoot,photoDate,'order-manifest.json');
        const historicalManifest = fs.existsSync(historicalManifestFile) ? JSON.parse(fs.readFileSync(historicalManifestFile,'utf8')) : null;
        if (uploadOrderScope.proven) {
          latestOrderState = await queryPdfBoundPhotoUploadState(photoSite,photoDate,uploadOrderScope);
          receipt.orderScopeEvidence = uploadOrderScope.reason;
          receipt.orderScopeCount = uploadOrderScope.orderCount;
          receipt.orderScopeHash = uploadOrderScope.orderIdHash;
          receipt.lastOnlineOrderState = orderStateEvidence(latestOrderState);
          if (latestOrderState.state === 'ambiguous') {
            receipt.stage = 'online-order-set-ambiguous';
            atomic(receiptFile,receipt);
            throw new Error(`线上订单集合核对不完整：PDF 凭据内 ${latestOrderState.expectedCount} 条订单有 ${latestOrderState.conflictCount} 条无法在“已上传/未上传”中唯一归类。未上传任何文件。`);
          }
          const reconciledAt = new Date().toISOString();
          if (latestOrderState.state === 'all-uploaded') {
            markAllAvailableFilesUploaded('pdf-bound-order-set-all-uploaded',reconciledAt);
            receipt.complete = true;
            receipt.batchCompleteReady = manifest.batchCompleteReady === true;
            receipt.onlineClosureCheckReady = true;
            receipt.stage = manifest.batchCompleteReady ? 'online-order-set-reconciled-complete' : 'available-files-complete-waiting-for-supplement';
            receipt.completedAt = reconciledAt;
            receipt.batches.push({
              uploadedCount:manifest.counts.blessing,
              month:photoDate.slice(0,7).replace('-',''),
              files:manifest.files.blessing.map((file)=>path.basename(file)),
              evidence:'pdf-bound-order-set-all-uploaded',
              matchedOrderCount:latestOrderState.uploadedCount,
            });
            atomic(receiptFile,receipt);
            photoTiming.end();
            log(`线上订单集合复核通过：与当前 PDF 哈希绑定的 ${latestOrderState.expectedCount} 条订单均为“福单已上传”；本地 ${manifest.counts.blessing} 张照片不会重复提交。`);
            await photoSite.close();
            photoTiming.finish();
            process.exit(0);
          }
          if (latestOrderState.state === 'partial') {
            receipt.stage = 'online-order-set-partial-stop';
            atomic(receiptFile,receipt);
            throw new Error(`线上订单集合显示部分上传：当前 PDF 对应 ${latestOrderState.expectedCount} 条订单中，${latestOrderState.uploadedCount} 条已上传、${latestOrderState.pendingCount} 条未上传。订单与纸张照片不是一对一关系，程序不会猜测或重复上传。`);
          }
          if (Object.keys(uploadedFiles).length) {
            receipt.stage = 'local-receipt-online-state-conflict';
            atomic(receiptFile,receipt);
            throw new Error('本地已有成功上传回执，但与当前 PDF 绑定的线上订单全部显示未上传；证据冲突，已停止。');
          }
          if (receipt.uncertainSubmission) {
            receipt.stage='upload-outcome-unconfirmed-no-resubmit';
            atomic(receiptFile,receipt);
            throw new Error('上次提交结果仍未确认；即使重新启动也不会重传。请先核实平台上传结果。');
          }
          receipt.stage = 'online-order-set-confirmed-none-uploaded';
          atomic(receiptFile,receipt);
          log(`线上订单集合复核通过：与当前 PDF 哈希绑定的 ${latestOrderState.expectedCount} 条订单全部仍为“福单未上传”，确认上次提交未生效；允许安全重试当前照片集合。`);
        } else {
          const alreadyUploaded = await photoSite.queryUploadedOrders(photoDate,{productMode:'all',allStates:true});
          const notUploaded = await photoSite.queryNotUploadedOrders(photoDate,{productMode:'all',allStates:true});
          const uploadedTablet = await photoSite.queryUploadedTabletPhotoOrders(photoDate);
          const notUploadedTablet = await photoSite.queryNotUploadedTabletPhotoOrders(photoDate);
          const onlineUploadedCount = alreadyUploaded.length + uploadedTablet.length;
          const onlinePendingRows = [
            ...notUploaded.map((row) => ({ ...row,kind:'lamp' })),
            ...notUploadedTablet.map((row) => ({ ...row,kind:'tablet' })),
          ];
          if (manifest.manualNumberedMode && onlineUploadedCount > 0 && pendingFiles.length) {
            log(`正在只读核对 ${pendingFiles.length} 张缺回执照片；同日仍有待补订单时也逐张保存已上传证据。`);
            const readback=await reconcileManualUploadedPhotos({
              site:photoSite,date:photoDate,files:pendingFiles,allFiles:manifest.files.blessing,
              fileHashes:manifest.fileHashes,onMatch:persistReadbackMatch,
            });
            receipt.readbackScannedImageCount=readback.scanned;
            receipt.readbackDiagnostics={...readback.diagnostics,missingNames:readback.missingNames};
            receipt.readbackMatchedCount=readback.matched.length;
            pendingFiles=manifest.files.blessing.filter(file=>
              receipt.uploadedFiles[path.basename(file)]?.sha256!==manifest.fileHashes[path.basename(file)]);
            verifiedCurrentBlessingCount=manifest.files.blessing.length-pendingFiles.length;
            batches=splitUploadBatches(pendingFiles);
            if (!pendingFiles.length) {
              assertManualAttemptResolved(receipt,manifest.fileHashes);
              finalizeManualUploadCorrection(receipt);
              receipt.batches.push({uploadedCount:readback.matched.length,
                files:readback.matched.map(item=>item.name),evidence:'online-image-readback'});
              receipt.complete=true;
              receipt.batchCompleteReady=manifest.batchCompleteReady===true;
              receipt.onlineClosureCheckReady=onlinePendingRows.length===0;
              receipt.uncertainSubmission=false;
              receipt.stage='manual-photo-online-image-readback-complete';
              receipt.completedAt=new Date().toISOString();
              atomic(receiptFile,receipt);
              photoTiming.end();
              log(`线上图片核对通过：本机 ${manifest.counts.blessing} 张福单图均已确认上传；线上仍有 ${onlinePendingRows.length} 条未上传订单，继续处理已有照片对应的场景图。本次没有重复上传。`);
              await photoSite.close();
              photoTiming.finish();
              process.exit(0);
            }
            if (receipt.uncertainSubmission || onlinePendingRows.length===0) {
              receipt.stage='manual-photo-online-image-readback-incomplete';
              atomic(receiptFile,receipt);
              throw new Error(`线上图片核对：已保存 ${receipt.uploadedCount} 张照片的凭据，仍需核对 ${readback.missingNames.join('、')}。没有再次上传；缺少逐张确认的照片不会被误记为完成。`);
            }
            atomic(receiptFile,receipt);
          }
          if (onlineUploadedCount !== 0 || onlinePendingRows.length !== 0) {
            manualResume = manifest.manualNumberedMode
              ? decideManualPhotoResume({
                blessingCount:manifest.counts.blessing,
                verifiedReceiptCount:verifiedCurrentBlessingCount,
                pendingFiles,
                uncertainSubmission:receipt.uncertainSubmission,
                onlineUploadedCount,
                onlinePendingRows,
              }) : null;
            if (manifest.manualNumberedMode && receipt.uncertainSubmission && !manualResume?.allowed) {
              await new Promise((resolve)=>setTimeout(resolve,3000));
              const second=await queryManualUploadState();
              const recovery=decideManualPhotoUncertainRetry({
                blessingCount:manifest.counts.blessing,
                verifiedReceiptCount:verifiedCurrentBlessingCount,
                pendingFiles,previousAttempt:receipt.previousAttempt,
                uncertainRetryCount:receipt.uncertainRetryCount,
                correctionSubmissionPending:hasPendingManualUploadCorrection(receipt),
                onlineUploadedCount,secondOnlineUploadedCount:second.uploadedCount,
                firstPendingRows:onlinePendingRows,secondPendingRows:second.pendingRows,
              });
              if (recovery.allowed) {
                manualResume=recovery;
                allowOneTimeRetry=true;
                reserveManualUploadRetry(receipt,recovery);
                receipt.stage='manual-photo-one-time-retry-ready';
                atomic(receiptFile,receipt);
                log(`上次提交未取得数字回执；超过 15 分钟后两次查询均为 0 条已上传、${recovery.pendingOrderRows.length} 条未上传，订单集合一致。仅允许当前照片集合受控重试一次。`);
              }
              if (!manualResume?.allowed) {
                const review=prepareManualUploadCorrectionReview({
                  businessDate:photoDate,receipt,
                  currentFiles:pendingFiles.map(file=>path.basename(file)),currentFileHashes:manifest.fileHashes,
                  preparationReceipt:readJson(path.join(photoRunDir,'photo-prepare-receipt.json'),null),
                  firstOnline:{uploadedCount:onlineUploadedCount,pendingRows:onlinePendingRows},secondOnline:second,
                });
                if (review.eligible) {
                  const savedApproval=receipt.correctedAttempts?.[review.correctionId];
                  const token=args['confirm-upload-correction'] || (savedApproval?.status==='approved' ? review.confirmationToken : '');
                  if (!token) {
                    atomic(path.join(photoRunDir,'photo-upload-correction-review.json'),{...review,fileSetHash:manifest.fileSetHash});
                    receipt.stage='manual-photo-correction-awaiting-confirmation';
                    atomic(receiptFile,receipt);
                    const changes=review.renamedFiles?.length
                      ? `仅修改文件名：${review.renamedFiles.map(item=>`${item.name} → ${item.renamedTo}`).join('、')}；图片内容未变`
                      : '移除项均为重复内容';
                    throw new Error(`已核对修正后的照片：原 ${review.oldAttempt.files.length} 张，当前 ${review.currentFiles.length} 张，${changes}。旧上传结果仍未确认；请在软件提示中确认是否按当前清单重新提交一次。尚未重新上传。`);
                  }
                  approveManualUploadCorrection(receipt,review,{confirmationToken:token,confirmed:true});
                  uploadCorrectionId=review.correctionId;
                  manualResume={allowed:true,pendingFiles:review.currentFiles,pendingOrderRows:second.pendingRows};
                  receipt.stage='manual-photo-correction-approved';
                  atomic(receiptFile,receipt);
                  log(`已确认按修正后的 ${review.currentFiles.length} 张照片重新提交一次；保留旧 ${review.oldAttempt.files.length} 张的未知结果记录。`);
                } else if (args['confirm-upload-correction']) {
                  throw new Error('照片、旧记录或线上订单状态已变化，本次修正确认已失效；没有重新上传。');
                }
              }
            }
            if (manualResume?.allowed) {
              receipt.stage='manual-photo-resume-ready';
              receipt.pendingOrderCount=manualResume.pendingOrderRows.length;
              receipt.pendingOrderIdHash=crypto.createHash('sha256')
                .update(manualResume.pendingOrderRows.map((row)=>`${row.kind}:${row.id}`).sort().join('\n')).digest('hex');
              atomic(receiptFile,receipt);
              log(`本机已有 ${verifiedCurrentBlessingCount} 张当前照片的逐文件哈希回执，剩余 ${manualResume.pendingFiles.length} 张；线上还有 ${manualResume.pendingOrderRows.length} 条未上传。本次只提交无回执照片，每批完成后核对线上订单变化。`);
            } else {
              const bindingLabel = manifest.manualNumberedMode ? '上次照片上传结果尚未确认' : '当前 PDF 缺少可验证的订单 ID 绑定凭据';
              const retryReason=receipt.uncertainRetryCount > 0
                ? '已有一次受控重试记录，需要核对它的提交结果后才能继续'
                : receipt.previousAttempt?.uploadedCount != null
                  ? '上次已有上传数量回执，需先核对该回执对应的线上结果'
                  : '提交后状态不明，或两次线上订单集合不一致，尚不满足安全重试条件';
              receipt.stage='manual-photo-retry-evidence-conflict';
              atomic(receiptFile,receipt);
              if (manifest.manualNumberedMode) {
                const request=receipt.currentBatchTransportRequestSeen===true || receipt.currentBatchUploadEvidence?.requestStarted===true;
                const response=receipt.currentBatchTransportResponseSeen===true || receipt.currentBatchUploadEvidence?.responseSeen===true;
                const stage=receipt.currentBatchSubmissionStage || receipt.previousAttempt?.stage || '旧版未记录';
                log(`上次上传记录：阶段 ${stage}；上传请求 ${request?'已观察到':'没有可靠记录'}；接口响应 ${response?'已观察到':'没有可靠记录'}。本次只查询状态，没有再次上传。`);
              }
              throw new Error(`${bindingLabel}，线上供灯/牌位共 ${onlineUploadedCount} 条已上传、${onlinePendingRows.length} 条未上传；${retryReason}，没有再次提交照片。`);
            }
          } else {
          const pendingRegular = await photoSite.queryLamp(photoDate);
          const pendingTablet = await photoSite.queryDailyTablet(photoDate);
          const closureEvidence = resolveHistoricalPhotoClosureEvidence({ historicalManifest, manifest });
          if (closureEvidence.proven && pendingRegular.length === 0 && pendingTablet.length === 0) {
            const reconciledAt = new Date().toISOString();
            receipt.complete = true;
            receipt.batchCompleteReady = true;
            receipt.onlineClosureCheckReady = true;
            receipt.stage = 'manual-online-closure-reconciled';
            receipt.uploadedCount = manifest.counts.blessing;
            receipt.onlineMatchedOrderCount = closureEvidence.historicalOrderCount;
            receipt.closureEvidenceSource = closureEvidence.source;
            receipt.legacyPdfPageCount = closureEvidence.legacyPdfPageCount;
            receipt.reconciledAt = reconciledAt;
            receipt.manualBusinessCompletionDetected = true;
            for (const file of manifest.files.blessing) {
              const name = path.basename(file);
              receipt.uploadedFiles[name] = {sha256:manifest.fileHashes[name],uploadedAt:reconciledAt,evidence:'manual-online-closure-reconciled'};
            }
            receipt.batches = [{
              uploadedCount:manifest.counts.blessing,
              files:manifest.files.blessing.map((file)=>path.basename(file)),
              evidence:`${closureEvidence.source}-and-all-online-pending-zero`,
              historicalOrderCount:closureEvidence.historicalOrderCount,
              legacyPdfPageCount:closureEvidence.legacyPdfPageCount,
            }];
            atomic(receiptFile,receipt);
            atomic(path.join(photoRunDir,'scene-upload-receipt.json'),{
              schemaVersion:3,
              businessDate:photoDate,
              fileSetHash:manifest.fileSetHash,
              complete:true,
              partialComplete:false,
              stage:'manual-online-closure-reconciled',
              tabletCompletionVerified:true,
              regularCompletedOrderCount:0,
              tabletCompletedOrderCount:0,
              completedOrderCount:0,
              historicalOrderCount:closureEvidence.historicalOrderCount,
              closureEvidenceSource:closureEvidence.source,
              legacyPdfPageCount:closureEvidence.legacyPdfPageCount,
              manualBusinessCompletionDetected:true,
              reconciledAt,
              completedAt:reconciledAt,
            });
            photoTiming.end();
            const closureLabel = closureEvidence.source === 'historical-order-manifest'
              ? `历史清单有 ${closureEvidence.historicalOrderCount} 条订单`
              : `旧版完整 PDF/照片对应凭据有 ${closureEvidence.legacyPdfPageCount} 页`;
            log(`平台闭环复核通过：${closureLabel}，当前福单已上传、福单未上传、供灯待祈福和牌位待祈福均为 0；判定该日期已由人工完成，已补记本地闭环凭据，不会重复上传或修改订单。`);
            await photoSite.close();
            photoTiming.finish();
            process.exit(0);
          }
          const evidenceReason = closureEvidence.proven ? '' : '，但缺少历史订单清单或完整的旧版 PDF/照片对应凭据';
          throw new Error(`该日期线上“福单已上传”和“福单未上传”均为 0，供灯待祈福 ${pendingRegular.length} 条、牌位待祈福 ${pendingTablet.length} 条${evidenceReason}，无法安全判定闭环，已停止。`);
          }
        }
      }
      if (manifest.manualNumberedMode && !needsOnlineRetryCheck) {
        const before=await queryManualUploadState();
        manualResume=decideManualPhotoResume({
          blessingCount:manifest.counts.blessing,
          verifiedReceiptCount:verifiedCurrentBlessingCount,
          pendingFiles,uncertainSubmission:receipt.uncertainSubmission,
          onlineUploadedCount:before.uploadedCount,onlinePendingRows:before.pendingRows,
        });
        if (!manualResume.allowed) {
          receipt.stage='manual-photo-preflight-conflict';
          atomic(receiptFile,receipt);
          throw new Error(`上传前线上显示 ${before.uploadedCount} 条已上传、${before.pendingRows.length} 条未上传，与本机逐文件回执不一致；没有提交照片。`);
        }
        receipt.pendingOrderCount=manualResume.pendingOrderRows.length;
        receipt.pendingOrderIdHash=crypto.createHash('sha256').update(
          manualResume.pendingOrderRows.map((row)=>`${row.kind}:${row.id}`).sort().join('\n')).digest('hex');
        atomic(receiptFile,receipt);
        log(`上传前已记录同业务日期 ${manualResume.pendingOrderRows.length} 条未上传订单的 ID 集合哈希；完成后将核对订单变化。`);
      }
      let allFilesReconciled = false;
      if (args['confirm-upload-correction'] && !uploadCorrectionId) {
        throw new Error('本次修正确认与当前上传恢复条件不匹配；没有重新上传。');
      }
      if (receipt.uncertainSubmission && !allowOneTimeRetry && !uploadCorrectionId) {
        atomic(receiptFile,receipt);
        throw new Error('存在未确认的上传提交，当前证据不足以安全重传；请先复核线上状态。');
      }
      for (let index=0; index<batches.length; index++) {
        if (manualResume?.allowed && !manualResume.pendingOrderRows.length) {
          receipt.stage='manual-photo-no-online-pending-stop';
          atomic(receiptFile,receipt);
          throw new Error('剩余照片尚无回执，但线上已无未上传订单；已停止后续批次，避免重复提交。');
        }
        log(`正在上传第 ${index+1}/${batches.length} 批，共 ${batches[index].length} 张。`);
        receipt.currentBatch = index + 1;
        receipt.currentBatchFiles = batches[index].map((file)=>path.basename(file));
        receipt.currentBatchFileHashes = Object.fromEntries(receipt.currentBatchFiles.map(name=>[name,manifest.fileHashes[name]]));
        receipt.currentBatchStartedAt = new Date().toISOString();
        receipt.currentBatchCompletedAt=null;
        receipt.currentBatchUploadEvidence=null;
        receipt.currentBatchSubmissionStage=null;
        receipt.currentBatchTransportStatus=null;
        receipt.currentBatchTransportOutcome=null;
        receipt.currentBatchTransportRequestSeen=false;
        receipt.currentBatchTransportResponseSeen=false;
        receipt.currentBatchUploadCount=null;
        receipt.currentBatchPendingOrderCount=manualResume?.pendingOrderRows?.length ?? null;
        receipt.currentBatchPendingOrderIdHash=manualResume?.pendingOrderRows
          ? crypto.createHash('sha256').update(manualResume.pendingOrderRows.map(row=>`${row.kind}:${row.id}`).sort().join('\n')).digest('hex') : null;
        receipt.stage = 'starting';
        let beforeOrderState = null;
        if (uploadOrderScope.proven) {
          beforeOrderState = latestOrderState || await queryPdfBoundPhotoUploadState(photoSite,photoDate,uploadOrderScope);
          latestOrderState = null;
          receipt.currentBatchOrderSnapshot = orderStateEvidence(beforeOrderState);
          if (beforeOrderState.state === 'ambiguous') {
            receipt.stage = 'pre-upload-order-set-ambiguous';
            atomic(receiptFile,receipt);
            throw new Error(`上传前线上订单集合不完整：${beforeOrderState.conflictCount} 条订单无法唯一归类，未选择或上传文件。`);
          }
          if (beforeOrderState.state === 'all-uploaded') {
            markAllAvailableFilesUploaded('pre-upload-pdf-bound-order-set-all-uploaded');
            allFilesReconciled = true;
          }
        }
        atomic(receiptFile,receipt);
        let result = allFilesReconciled ? {
          uploadedCount:batches[index].length,
          month:photoDate.slice(0,7).replace('-',''),
          files:batches[index].map((file)=>path.basename(file)),
          evidence:'pre-upload-pdf-bound-order-set-all-uploaded',
        } : null;
        if (!allFilesReconciled) {
          try {
            const trackUploadStage = (stage,detail) => {
              receipt.stage = stage;
              if (manifest.manualNumberedMode && allowOneTimeRetry) markManualUploadRetrySubmitted(receipt,stage);
              if (uploadCorrectionId) markManualUploadCorrectionSubmitted(receipt,uploadCorrectionId,stage);
              // Persist before a potentially asynchronous write, not just in
              // the catch block: a crash/restart must not erase uncertainty.
              if (['month-submit-started','submitting','month-submitted','upload-confirmed','transport-request','transport-response','transport-outcome','transport-receipt','upload-receipt'].includes(stage)) {
                receipt.uncertainSubmission=true;
                receipt.currentBatchSubmissionStage=stage;
              }
              if (stage==='transport-request') receipt.currentBatchTransportRequestSeen=true;
              if (stage==='transport-response') {
                receipt.currentBatchTransportResponseSeen=true;
                receipt.currentBatchTransportStatus=detail?.status;
              }
              if (stage==='transport-outcome') receipt.currentBatchTransportOutcome=detail;
              if (stage==='transport-receipt' || stage==='upload-receipt' || stage==='upload-reconciled') receipt.currentBatchUploadCount=detail?.uploadedCount;
              atomic(receiptFile,receipt);
            };
            result = manifest.manualNumberedMode
              ? await uploadManualBatchWithRecovery({
                site:photoSite,date:photoDate,files:batches[index],allFiles:manifest.files.blessing,
                fileHashes:manifest.fileHashes,onStage:trackUploadStage,onMatch:persistReadbackMatch,
                onReconciliation:async (error)=>{
                  receipt.stage='manual-photo-reconciling-submitted-batch';
                  receipt.uncertainSubmission=true;
                  receipt.currentBatchUploadEvidence=error.uploadEvidence;
                  atomic(receiptFile,receipt);
                  const duplicate=error.uploadEvidence?.responseOutcomes?.some(item=>item.reason==='duplicate-image');
                  log(duplicate ? '后台提示“该图片已上传”；正在只读检查是否部分保存并关联订单，不能按成功记账。'
                    : error.uploadEvidence?.applicationFailure===true ? '后台返回上传失败；正在只读检查是否有部分照片已关联订单。'
                      : '后台未提供本批数字回执，正在自动回读同日线上图片逐张核对；核对后继续，不会再次提交。');
                },
              })
              : await photoSite.uploadBlessingBatch(batches[index],photoDate,trackUploadStage);
          } catch (uploadError) {
            if (uploadError?.readback) {
              receipt.stage='manual-photo-online-image-readback-incomplete';
              receipt.readbackDiagnostics={...uploadError.readback.diagnostics,missingNames:uploadError.readback.missingNames};
              receipt.readbackScannedImageCount=uploadError.readback.scanned;
              receipt.readbackMatchedCount=uploadError.readback.matched.length;
              atomic(receiptFile,receipt);
            }
            if (uploadError?.uploadEvidence) {
              receipt.currentBatchUploadEvidence=uploadError.uploadEvidence;
              atomic(receiptFile,receipt);
              log(`上传诊断：确认框 ${uploadError.uploadEvidence.confirmationSeen?'已出现':'未观察到'}、上传请求 ${uploadError.uploadEvidence.requestStarted?'已发出':'未观察到'}、接口响应 ${uploadError.uploadEvidence.responseSeen?'已返回':'未观察到'}；未取得本批数量回执。`);
            }
            if (uploadError?.code !== 'BLESSING_UPLOAD_OUTCOME_UNCONFIRMED') throw uploadError;
            receipt.uncertainSubmission=true;
            atomic(receiptFile,receipt);
            if (!uploadOrderScope.proven || !beforeOrderState) {
              const retryEvidence = manifest.manualNumberedMode
                ? '人工编号模式没有 PDF 订单绑定凭据'
                : '当前 PDF 没有可验证的“PDF文件哈希＋订单ID集合”绑定凭据';
              throw new Error(`${uploadError.message} ${retryEvidence}，禁止自动重试。`);
            }
            let afterOrderState;
            try {
              afterOrderState = await waitForUploadOrderOutcome(()=>queryPdfBoundPhotoUploadState(photoSite,photoDate,uploadOrderScope),{
                onSnapshot(snapshot) { receipt.lastOnlineOrderState=orderStateEvidence(snapshot); atomic(receiptFile,receipt); },
              });
            } catch {
              throw uploadError;
            }
            receipt.lastOnlineOrderState = orderStateEvidence(afterOrderState);
            receipt.reconciledAt = new Date().toISOString();
            if (afterOrderState.state === 'ambiguous') {
              receipt.stage = 'post-upload-order-set-ambiguous';
              atomic(receiptFile,receipt);
              throw new Error(`上传回执缺失，且线上有 ${afterOrderState.conflictCount} 条 PDF 订单无法唯一归类；已停止，不会再次提交。`);
            }
            if (afterOrderState.state === 'all-uploaded') {
              markAllAvailableFilesUploaded('post-upload-pdf-bound-order-set-all-uploaded',receipt.reconciledAt);
              receipt.onlineClosureCheckReady = true;
              receipt.stage = 'post-upload-order-set-reconciled';
              allFilesReconciled = true;
              result = {
                uploadedCount:batches[index].length,
                month:photoDate.slice(0,7).replace('-',''),
                files:batches[index].map((file)=>path.basename(file)),
                evidence:'post-upload-pdf-bound-order-set-all-uploaded',
              };
              log(`上传数字回执缺失，但当前 PDF 对应 ${afterOrderState.expectedCount} 条订单已全部变为“福单已上传”；确认本次提交成功，不会重传。`);
            } else if (!samePhotoOrderUploadSnapshot(beforeOrderState,afterOrderState)) {
              receipt.stage = 'post-upload-order-set-changed-partial-stop';
              atomic(receiptFile,receipt);
              throw new Error(`上传回执缺失后线上订单集合发生部分变化：${afterOrderState.uploadedCount} 条已上传、${afterOrderState.pendingCount} 条未上传。订单与纸张照片不是一对一关系，无法判断具体哪张成功；已停止且不会重传。`);
            } else {
              receipt.stage = 'upload-outcome-unconfirmed-no-resubmit';
              atomic(receiptFile,receipt);
              throw new Error('上传回执缺失，有限次线上复查仍未确认结果。没有变化不代表提交失败：已保留待核对状态，不会自动再次上传。请先复核线上状态。');
            }
          }
        }
        if (manualResume?.allowed && result?.evidence==='online-image-readback') {
          // Per-file content evidence confirms these files, even if other orders
          // still need photos. Whole-day completion belongs to the scene phase.
          const after=await queryManualUploadState();
          manualResume.pendingOrderRows=after.pendingRows;
          receipt.remainingPendingOrderCount=after.pendingRows.length;
          receipt.onlineVerifiedAt=new Date().toISOString();
          log(`本批 ${result.uploadedCount} 张已逐张回读确认；仍有 ${after.pendingRows.length} 条线上订单待补照片。`);
        } else if (manualResume?.allowed) {
          if (Number(result?.uploadedCount) !== batches[index].length) {
            receipt.stage='manual-photo-upload-count-unconfirmed';
            receipt.uncertainSubmission=true;
            atomic(receiptFile,receipt);
            throw new Error(`本批提交 ${batches[index].length} 张，但上传回执为 ${result?.uploadedCount} 张；结果不明，禁止自动重传。`);
          }
          receipt.currentBatchUploadCount=Number(result.uploadedCount);
          receipt.stage='manual-photo-online-verification';
          atomic(receiptFile,receipt);
          let progress={confirmed:false};
          for (let check=0;check<3 && !progress.confirmed;check++) {
            const afterUploadedLamp=await photoSite.queryUploadedOrders(photoDate,{productMode:'all',allStates:true});
            const afterPendingLamp=await photoSite.queryNotUploadedOrders(photoDate,{productMode:'all',allStates:true});
            const afterUploadedTablet=await photoSite.queryUploadedTabletPhotoOrders(photoDate);
            const afterPendingTablet=await photoSite.queryNotUploadedTabletPhotoOrders(photoDate);
            progress=manualPhotoUploadProgress(manualResume.pendingOrderRows,
              [...afterUploadedLamp.map((row)=>({...row,kind:'lamp'})),...afterUploadedTablet.map((row)=>({...row,kind:'tablet'}))],
              [...afterPendingLamp.map((row)=>({...row,kind:'lamp'})),...afterPendingTablet.map((row)=>({...row,kind:'tablet'}))]);
            if (!progress.confirmed && check<2) await new Promise((resolve)=>setTimeout(resolve,1000));
          }
          if (!progress.confirmed) {
            receipt.stage='manual-photo-online-unconfirmed';
            receipt.uncertainSubmission=true;
            atomic(receiptFile,receipt);
            throw new Error(`本批 ${batches[index].length} 张有上传数字回执，但原有未上传订单没有可确认的状态变化；已保留待核对状态，禁止再次自动提交。`);
          }
          receipt.onlineVerifiedAt=new Date().toISOString();
          manualResume.pendingOrderRows=progress.remainingRows;
          receipt.remainingPendingOrderCount=progress.remainingRows.length;
          log(`本批 ${batches[index].length} 张获得上传回执，原有线上未上传订单有 ${progress.movedCount} 条转为已上传，仍有 ${progress.remainingRows.length} 条未上传。`);
        }
        receipt.batches.push(result);
        if (Number(result.uploadedCount) !== batches[index].length) throw new Error(`本批上传回执 ${result.uploadedCount} 与提交文件 ${batches[index].length} 不一致。`);
        receipt.uncertainSubmission=false;
        for (const file of batches[index]) {
          const name = path.basename(file);
          if (receipt.uploadedFiles[name]?.sha256 !== manifest.fileHashes[name]) {
            receipt.uploadedFiles[name] = {sha256:manifest.fileHashes[name],uploadedAt:new Date().toISOString(),evidence:'batch-verified'};
          }
        }
        receipt.uploadedCount = Object.keys(receipt.uploadedFiles).length;
        if (uploadCorrectionId) confirmManualUploadCorrection(receipt,uploadCorrectionId,{
          uploadedFileHashes:Object.fromEntries(Object.entries(receipt.uploadedFiles).map(([name,item])=>[name,item.sha256])),
        });
        receipt.stage = 'batch-verified';
        receipt.currentBatchFiles = [];
        receipt.currentBatchUploadCount = null;
        receipt.currentBatchCompletedAt = new Date().toISOString();
        atomic(receiptFile,receipt);
        if (allFilesReconciled) break;
      }
      const currentManifestUploadedCount=manifest.files.blessing.filter((file)=>
        receipt.uploadedFiles[path.basename(file)]?.sha256===manifest.fileHashes[path.basename(file)]).length;
      if (currentManifestUploadedCount !== manifest.counts.blessing) throw new Error(`当前清单已有上传凭据 ${currentManifestUploadedCount} 张，与福单图 ${manifest.counts.blessing} 张不一致。`);
      finalizeManualUploadCorrection(receipt);
      receipt.complete = true;
      receipt.batchCompleteReady = manifest.batchCompleteReady === true;
      receipt.stage = manifest.batchCompleteReady ? 'complete' : 'available-files-complete-waiting-for-supplement';
      receipt.completedAt = new Date().toISOString();
      atomic(receiptFile,receipt);
      photoTiming.end();
      log(manifest.counts.missingBlessing > 0
        ? `现有福单图增量上传完成并校验：本次新增 ${pendingFiles.length} 张、累计 ${receipt.uploadedCount} 张；${manifest.photoAvailability.summary}。`
        : `全部福单图上传完成并校验：${receipt.uploadedCount} 张。场景图和订单批量完成尚未在本按钮中执行。`);
      await photoSite.close();
    } else if (args.action === 'photo-scenes') {
      if (args.authorized !== 'yes') throw new Error('场景图上传与批量完成缺少用户授权。');
      assertUnchangedManifest(manifest);
      const sceneManualIssues = Array.isArray(manifest.sceneManualIssues) ? manifest.sceneManualIssues : [];
      if (sceneManualIssues.length) {
        const reviewFile = path.join(photoRunDir,'photo-manual-review.json');
        atomic(reviewFile,{
          schemaVersion:1,
          businessDate:photoDate,
          createdAt:new Date().toISOString(),
          pendingIssues:sceneManualIssues,
          nextStep:'福单图上传结果已保留。请补齐或确认场景图后再次点击照片主按钮，程序将从场景图和批量完成继续。',
        });
        for (const issue of sceneManualIssues) log(`待人工处理（场景图/完成暂缓）：${issue}`);
        log('已确认福单图不会重传；请人工补齐或确认场景图后续跑。');
        photoTiming.finish();
        process.exit(0);
      }
      const sceneSourceEvidence = {
        businessDate: photoDate,
        photoDir: fs.realpathSync.native(path.join(photoDayFolder(activePhotoRoot, photoDate), '1')),
        originalPhotoDir:mirror?.sourcePhotoDir||null,
        mirrorIdentity:mirror?.identity||null,
        water: assertSceneFilesBelongToBusinessDate(activePhotoRoot, photoDate, manifest.files.waterScenes, 'water'),
        lamp: assertSceneFilesBelongToBusinessDate(activePhotoRoot, photoDate, manifest.files.lampScenes, 'lamp'),
        verifiedAt: new Date().toISOString(),
      };
      const uploadReceiptFile = path.join(photoRunDir,'photo-upload-receipt.json');
      if (!fs.existsSync(uploadReceiptFile)) throw new Error('没有找到福单图上传凭据，请先完成“上传福单图”。');
      const uploadReceipt = JSON.parse(fs.readFileSync(uploadReceiptFile,'utf8'));
      const legacyExactReceipt = (!uploadReceipt.uploadedFiles || Object.keys(uploadReceipt.uploadedFiles).length === 0)
        && uploadReceipt.fileSetHash === manifest.fileSetHash
        && Number(uploadReceipt.uploadedCount) === manifest.counts.blessing;
      const everyCurrentBlessingUploaded = legacyExactReceipt || manifest.files.blessing.every((file) => {
        const name = path.basename(file);
        return uploadReceipt.uploadedFiles?.[name]?.sha256 === manifest.fileHashes?.[name];
      });
      if (!uploadReceipt.complete || !everyCurrentBlessingUploaded
        || Number(uploadReceipt.uploadedCount) < manifest.counts.blessing) {
        throw new Error('福单图上传凭据与当前文件不一致，请重新预检并核对线上数量。');
      }
      const sceneReceiptFile = path.join(photoRunDir,'scene-upload-receipt.json');
      let previousSceneReceipt = null;
      let priorCompletionBatches = [];
      let regularAlreadyComplete = false;
      if (fs.existsSync(sceneReceiptFile)) {
        const previous = JSON.parse(fs.readFileSync(sceneReceiptFile,'utf8'));
        priorCompletionBatches = Array.isArray(previous.completedBatches) ? previous.completedBatches : [];
        if (previous.fileSetHash === manifest.fileSetHash && previous.complete && previous.tabletCompletionVerified === true
          && previous.onlineVerifiedAt && Number(previous.completedOrderCount) > 0) {
          log(`相同图片集合的照片业务已经全部完成：供灯/供水 ${previous.regularCompletedOrderCount ?? previous.completedOrderCount ?? 0} 条，牌位 ${previous.tabletCompletedOrderCount ?? 0} 条；本次不会重复提交。`);
          photoTiming.finish();
          process.exit(0);
        }
        if (previous.fileSetHash === manifest.fileSetHash && previous.partialComplete === true && previous.tabletCompletionVerified === true) {
          log(`相同图片集合中所有已上传订单已经分批完成：供灯/供水 ${previous.regularCompletedOrderCount ?? 0} 条、牌位 ${previous.tabletCompletedOrderCount ?? 0} 条；${manifest.photoAvailability.summary}。本次不会重复提交。`);
          photoTiming.finish();
          process.exit(0);
        }
        if (previous.fileSetHash === manifest.fileSetHash && previous.complete
          && Number(previous.completedOrderCount || 0) > 0 && !previous.onlineVerifiedAt) {
          throw new Error('旧版批量完成回执缺少线上终态核查，不能直接重跑或覆盖；请先使用照片主按钮只读核对该业务日期。');
        }
        if (previous.fileSetHash === manifest.fileSetHash && previous.complete && previous.onlineVerifiedAt
          && Number(previous.regularCompletedOrderCount || 0) > 0) {
          regularAlreadyComplete = true;
          previousSceneReceipt = previous;
          log(`供灯/供水 ${previous.completedOrderCount ?? 0} 条已有完成回执；继续补做牌位“图片上传后批量完成”，不会重复处理前述订单。`);
        }
        if (previous.fileSetHash === manifest.fileSetHash && (!previous.complete || Number(previous.completedOrderCount || 0) === 0)) {
          log('检测到上次场景图流程中断；本次将按线上“场景图未上传”状态逐类复核并安全续跑，不会重传已成功的订单。');
          previousSceneReceipt = previous;
        }
      }
      const sceneReceipt = {
        schemaVersion:3,
        businessDate:photoDate,
        fileSetHash:manifest.fileSetHash,
        startedAt:previousSceneReceipt?.startedAt || new Date().toISOString(),
        resumedAt:previousSceneReceipt ? new Date().toISOString() : null,
        complete:false,
        partialComplete:false,
        stage:'scene-online-recheck',
        results:Array.isArray(previousSceneReceipt?.results) ? previousSceneReceipt.results : [],
        completedBatches:priorCompletionBatches,
        sceneSourceEvidence,
      };
      atomic(sceneReceiptFile,sceneReceipt);
      photoSite = new PrayerSite(photoRunDir,photoTiming,log,siteOptions);
      await photoSite.open();
      photoTiming.start('upload');
      let onlineNotUploadedCount = null;
      const manualReviewCount = Array.isArray(manifest.manualIssues) ? manifest.manualIssues.length : 0;
      {
        const notUploaded = await photoSite.queryNotUploadedOrders(photoDate,{productMode:'all',allStates:true});
        const notUploadedTablet = await photoSite.queryNotUploadedTabletPhotoOrders(photoDate);
        onlineNotUploadedCount = notUploaded.length + notUploadedTablet.length;
        uploadReceipt.onlineNotUploadedCount = onlineNotUploadedCount;
        uploadReceipt.onlineBusinessDateVerified = photoDate;
        uploadReceipt.onlineClosureCheckReady = false;
        if (onlineNotUploadedCount === 0) {
          const preparePlanFile = path.join(photoRunDir,'photo-prepare-plan.json');
          const preparePlan = fs.existsSync(preparePlanFile) ? JSON.parse(fs.readFileSync(preparePlanFile,'utf8')) : null;
          uploadReceipt.localMissingSupersededByOnline = Array.isArray(preparePlan?.missingExpected) ? preparePlan.missingExpected : [];
          uploadReceipt.batchCompleteReady = true;
          uploadReceipt.reexportOrOldPdfResolvedAt = new Date().toISOString();
          log(`历史补图线上闭环已确认：${photoDate} 的“福单未上传”为 0。${uploadReceipt.localMissingSupersededByOnline.length ? `本地旧 PDF 待补编号 ${uploadReceipt.localMissingSupersededByOnline.join('、')} 已记为由重发/重导出结果替代。` : ''}`);
        } else {
          uploadReceipt.batchCompleteReady = false;
          log(`该日期仍有 ${onlineNotUploadedCount} 条“福单未上传”；本次只处理福单已上传的订单，未上传订单继续保留待补，不会混入批量完成。`);
        }
        atomic(uploadReceiptFile,uploadReceipt);
      }
      if (!regularAlreadyComplete) {
        await finishScenePasses(photoSite,photoDate,[['water',manifest.files.waterScenes],['lamp',manifest.files.lampScenes]],{
          expectedPhotoDir:sceneSourceEvidence.photoDir,
          onStage(mode) {
          sceneReceipt.stage = `scene-${mode}`;
          atomic(sceneReceiptFile,sceneReceipt);
          },
          onResult(current) {
          const mode=current.mode;
          const priorIndex = sceneReceipt.results.findIndex((item) => item?.mode === mode);
          // 若上次已上传成功，本次线上查询会得到“没有未上传订单”。保留原成功数量，
          // 只增加复核时间，避免把完成证据覆盖成 selectedCount=0。
          if (current.skipped && priorIndex >= 0 && Number(sceneReceipt.results[priorIndex]?.selectedCount || 0) > 0) {
            sceneReceipt.results[priorIndex] = {...sceneReceipt.results[priorIndex],onlineReverifiedAt:new Date().toISOString()};
          } else if (priorIndex >= 0) sceneReceipt.results[priorIndex] = current;
          else sceneReceipt.results.push(current);
          atomic(sceneReceiptFile,sceneReceipt);
          },
          onRetry(remaining) { photoTiming.count('retry_count'); log(`复核仍有 ${remaining} 条场景图未上传，按当前缺失集合安全续跑，不重复处理已成功订单。`); },
        });
      }
      const completableRows = regularAlreadyComplete ? [] : await photoSite.queryUploadedOrders(photoDate,{productMode:'all',sceneStatus:'已上传',state:'祈福中'});
      const completableManifest = completableRows.length ? PrayerSite.manifest(completableRows,photoDate) : null;
      const expectedOrderCount = regularAlreadyComplete
        ? Number(previousSceneReceipt?.regularCompletedOrderCount ?? previousSceneReceipt?.completedOrderCount ?? 0)
        : completableRows.length;
      sceneReceipt.stage = 'batch-complete-online-recheck';
      sceneReceipt.expectedOrderCount = expectedOrderCount;
      sceneReceipt.expectedOrderIdHash = completableManifest?.orderIdHash || previousSceneReceipt?.expectedOrderIdHash || null;
      atomic(sceneReceiptFile,sceneReceipt);
      photoTiming.end();
      photoTiming.start('order-processing');
      const regularCompletedOrderCount = regularAlreadyComplete
        ? expectedOrderCount
        : expectedOrderCount > 0
          ? await photoSite.completeUploadedPhotoOrders(photoDate,expectedOrderCount,completableManifest.orderIdHash)
          : 0;
      sceneReceipt.regularCompletedOrderCount = regularCompletedOrderCount;
      sceneReceipt.stage = 'tablet-complete-online-recheck';
      const pendingTabletRows = await photoSite.queryUploadedTabletOrders(photoDate);
      const tabletManifest = PrayerSite.manifest(pendingTabletRows,photoDate);
      sceneReceipt.tabletExpectedOrderCount = pendingTabletRows.length || Number(previousSceneReceipt?.tabletExpectedOrderCount || 0);
      sceneReceipt.tabletOrderIdHash = pendingTabletRows.length ? tabletManifest.orderIdHash : (previousSceneReceipt?.tabletOrderIdHash || null);
      atomic(sceneReceiptFile,sceneReceipt);
      const tabletCompletedOrderCount = await photoSite.completeUploadedTabletOrders(
        photoDate,
        sceneReceipt.tabletExpectedOrderCount,
        pendingTabletRows.length ? tabletManifest.orderIdHash : null,
      );
      photoTiming.end();
      const photoOrderClosure = evaluatePhotoOrderClosure({
        missingBlessingCount:manifest.counts.missingBlessing,
        onlineNotUploadedCount,manualReviewCount,
        completedOrderCount:regularCompletedOrderCount+tabletCompletedOrderCount,
      });
      const completedAt = new Date().toISOString();
      const completionBatch = {
        fileSetHash:manifest.fileSetHash,
        blessingFileCount:manifest.counts.blessing,
        missingBlessingCount:manifest.counts.missingBlessing,
        onlineNotUploadedCount,
        manualReviewCount,
        regularCompletedOrderCount,
        tabletCompletedOrderCount,
        regularOrderIdHash:sceneReceipt.expectedOrderIdHash,
        tabletOrderIdHash:sceneReceipt.tabletOrderIdHash,
        completedAt,
      };
      sceneReceipt.completedBatches = upsertPhotoCompletionBatch(sceneReceipt.completedBatches,completionBatch);
      sceneReceipt.complete = photoOrderClosure.complete;
      sceneReceipt.partialComplete = photoOrderClosure.partial;
      sceneReceipt.onlineNotUploadedCount = onlineNotUploadedCount;
      sceneReceipt.stage = photoOrderClosure.stage;
      sceneReceipt.tabletCompletionVerified = true;
      sceneReceipt.tabletCompletedOrderCount = tabletCompletedOrderCount;
      sceneReceipt.completedOrderCount = regularCompletedOrderCount + tabletCompletedOrderCount;
      sceneReceipt.cumulativeCompletedOrderCount = sceneReceipt.completedBatches.reduce((sum,item) => sum + Number(item?.regularCompletedOrderCount || 0) + Number(item?.tabletCompletedOrderCount || 0),0);
      sceneReceipt.completedAt = completedAt;
      sceneReceipt.onlineVerifiedAt = photoOrderClosure.complete ? completedAt : null;
      atomic(sceneReceiptFile,sceneReceipt);
      log(photoOrderClosure.complete
        ? `照片业务闭环完成：供灯/供水 ${regularCompletedOrderCount} 条、牌位 ${tabletCompletedOrderCount} 条均已批量完成，总计 ${sceneReceipt.completedOrderCount} 条。`
        : `已分批完成现有已上传订单：供灯/供水 ${regularCompletedOrderCount} 条、牌位 ${tabletCompletedOrderCount} 条；线上仍有 ${onlineNotUploadedCount} 条福单未上传或本地有 ${manualReviewCount} 项待人工确认，补录后只处理剩余订单。`);
      await photoSite.close();
    }
    photoTiming.finish();
    process.exit(blockingErrors.length ? 1 : 0);
  } catch (error) {
    fail(cleanErrorMessage(error));
    const failedPhase = photoTiming.current?.phase ?? null;
    try { if (photoTiming.current) photoTiming.end('failed',String(error.message).slice(0,80)); photoTiming.event('blocked',failedPhase,0); } catch {}
    if (photoSite) await photoSite.close().catch(()=>{});
    try { photoTiming.finish(); } catch {}
    process.exit(1);
  }
}

const runDir = path.join(workdaysRoot,pdfDate); fs.mkdirSync(runDir,{recursive:true});
const timing = new Timing(runDir,'pdf-only',pdfDate); let site;
try {
  timing.start('date-resolution'); log(`PDF业务日期：${pdfDate}，查询区间为当天到次日（不含次日）。`); timing.end();
  site = new PrayerSite(runDir,timing,log,siteOptions); await site.open();
  if (args.action === 'renewal-state-change') {
    if (args.authorized !== 'yes') throw new Error('续费“代理已处理”缺少本次明确授权。');
    await autoCompleteRenewalState(site,runDir,pdfDate,timing,log);
  } else if (args.action === 'state-change') {
    if (args.authorized !== 'yes') throw new Error('状态变更缺少用户授权。');
    const stateFile=path.join(runDir,'run-state.json'); if(!fs.existsSync(stateFile)) throw new Error('没有找到 PDF 校验状态。'); const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
    if(!state.pdfVerified || state.stateChanged) throw new Error('PDF 未校验，或状态已经变更。');
    timing.start('order-processing');
    let changed=0;
    if(state.lamp && !state.lamp.stateChanged && state.lamp.orderCount){const count=await site.changeState(pdfDate,state.lamp.orderIdHash,{pageType:'lamp'}); state.lamp.stateChanged=true; state.lamp.changedCount=count; changed+=count; atomic(stateFile,state);}
    if(state.tablet && !state.tablet.stateChanged && state.tablet.orderCount){const count=await site.changeState(pdfDate,state.tablet.orderIdHash,{pageType:'tablet'}); state.tablet.stateChanged=true; state.tablet.changedCount=count; changed+=count; atomic(stateFile,state);}
    if(!state.lamp && !state.tablet){changed=await site.changeState(pdfDate,state.orderIdHash,{pageType:'lamp'});}
    timing.end(); state.stateChanged=true; state.changedCount=changed; state.changedAt=new Date().toISOString(); atomic(stateFile,state); atomic(path.join(runDir,'online-verification.json'),{schemaVersion:1,businessDate:pdfDate,checkedAt:new Date().toISOString(),localPdfCount:fs.readdirSync(dayFolder(root,pdfDate)).filter((name)=>/\.pdf$/i.test(name)).length,blessingPendingCount:0,tabletPendingCount:0,complete:true}); log(`已把 ${changed} 条供灯/牌位订单修改为祈福中，并复核待祈福为 0。`);
  } else {
    timing.start('pdf-query'); const rows = await site.queryLamp(pdfDate); timing.count('export_order_count',rows.length);
    const manifest = PrayerSite.manifest(rows,pdfDate); timing.end();
    timing.start('tablet-renewal'); const tabletRows = await site.queryDailyTablet(pdfDate); timing.count('export_order_count',tabletRows.length); const tabletManifest = PrayerSite.manifest(tabletRows,pdfDate); atomic(path.join(runDir,'tablet-manifest.json'),tabletManifest); timing.end();
    await site.assertBlessingExportContext(manifest.orderIdHash, rows.length);
    timing.start('tablet-renewal'); const renewal = await inspectRenewals(site,runDir,pdfDate); timing.count('export_order_count',renewal.rows.length); timing.end();
    if (args['diagnose-export'] === 'yes') {
      log(`PDF导出控件诊断：${JSON.stringify(await site.describePdfExportControls())}`);
      log(`日常模块菜单诊断：${JSON.stringify(await site.describeDailyModuleLinks())}`);
      const lampModuleRows = await site.queryLamp(pdfDate);
      log(`正确供灯福单页诊断：${JSON.stringify({count:lampModuleRows.length,controls:await site.summarizePdfExportControls()})}`);
      const dailyTabletRows = await site.queryDailyTablet(pdfDate);
      log(`正确牌位福单页诊断：${JSON.stringify({count:dailyTabletRows.length,controls:await site.summarizePdfExportControls()})}`);
    }
    const localPdfDir = dayFolder(root,pdfDate);
    const localPdfs = fs.existsSync(localPdfDir) ? fs.readdirSync(localPdfDir).filter((name)=>/\.pdf$/i.test(name)) : [];
    const baseStateBeforeExport=readJson(path.join(runDir,'run-state.json'),null);
    const incrementalProgressFile=path.join(runDir,'incremental-pdf-export-progress.json');
    const baseProgressFile=path.join(runDir,'pdf-export-progress.json');
    const pendingIncrementalProgress=readJson(incrementalProgressFile,null);
    const partialReceiptFile=(isPdfWorkflowComplete(baseStateBeforeExport) && pendingIncrementalProgress && !pendingIncrementalProgress.complete) ? incrementalProgressFile : baseProgressFile;
    const partialReceipt=readJson(partialReceiptFile,null);
    const resumablePartial=partialReceipt && !partialReceipt.complete && partialReceipt.businessDate===pdfDate && partialReceipt.lampOrderIdHash===manifest.orderIdHash && partialReceipt.tabletOrderIdHash===tabletManifest.orderIdHash;
    let incrementalMode = partialReceiptFile===incrementalProgressFile && resumablePartial;
    let skipRegularExport = false;
    if (localPdfs.length && !resumablePartial) {
      const inbox = ensurePhotoInbox(localPdfDir);
      if (inbox.created) log(`检测到当天已有 PDF，已补建原始照片目录：${inbox.photoInbox}`);
    }
    const onlineVerification = { schemaVersion:1, businessDate:pdfDate, checkedAt:new Date().toISOString(), localPdfCount:localPdfs.length, blessingPendingCount:rows.length, tabletPendingCount:tabletRows.length, renewalPendingCount:renewal.rows.length, complete:localPdfs.length>0 && rows.length===0 && tabletRows.length===0 };
    atomic(path.join(runDir,'online-verification.json'),onlineVerification);
    log(`线上复核：供灯福单页 ${rows.length} 条待祈福；牌位福单页 ${tabletRows.length} 条待祈福；续费管理 ${renewal.rows.length} 条未处理。`);
    if (onlineVerification.complete) log('本地已有 PDF，且线上福单与牌位待祈福均为 0；当天 PDF 工作确认已完成。');
    else if (localPdfs.length) log('本地虽已有 PDF，但线上仍有待祈福数据；当天不能判定为全部完成。');
    if (args.action === 'inspect') {
      const stateFile=path.join(runDir,'run-state.json');
      const previousState=fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile,'utf8')) : null;
      atomic(path.join(runDir,'online-current-manifest.json'),manifest);
      if (previousState?.pdfVerified && onlineVerification.complete) {
        timing.start('pdf-finalize');
        const existing = await loadVerifiedPdfWorkflow(runDir,localPdfDir,pdfDate);
        timing.count('pdf_page_count',existing.verifiedOutputs.reduce((sum,item)=>sum+item.pageCount,0));
        timing.end();
        if (!isPdfWorkflowComplete(existing.state)) {
          existing.state = markOnlineCompletionVerified(existing.state,pdfDate,onlineVerification.checkedAt);
          atomic(existing.stateFile,existing.state);
          log('PDF 凭据与文件哈希校验通过，线上供灯和牌位待祈福均为 0；已补记当天完成状态，没有重复修改线上数据。');
        }
      } else if (!previousState?.pdfVerified) {
        atomic(stateFile,{pdfDate,inspected:true,pdfVerified:false,stateChanged:false,orderIdHash:manifest.orderIdHash,orderCount:rows.length,tabletOrderCount:tabletRows.length,onlineComplete:onlineVerification.complete});
      }
      log('只检查模式完成，没有导出，也没有修改状态；已有 PDF 校验凭据不会被覆盖。');
    }
    else if (args.action === 'export') {
    if (args.authorized !== 'yes') throw new Error('本按钮包含校验后的状态变更，缺少执行授权。');
    const folder = dayFolder(root,pdfDate); fs.mkdirSync(folder,{recursive:true});
    if (localPdfs.length && !resumablePartial) {
      timing.start('pdf-finalize');
      const existing = await loadVerifiedPdfWorkflow(runDir,folder,pdfDate);
      timing.count('pdf_page_count',existing.verifiedOutputs.reduce((sum,item)=>sum+item.pageCount,0)); timing.end();
      if (isPdfWorkflowComplete(existing.state)) {
        if (rows.length || tabletRows.length) {
          const currentCombined=PrayerSite.manifest([...rows,...tabletRows],pdfDate);
          const incrementalStateFile=path.join(runDir,'incremental-current-state.json');
          const incrementalState=readJson(incrementalStateFile,null);
          if(incrementalState?.pdfVerified && !incrementalState.stateChanged && incrementalState.orderIdHash===currentCombined.orderIdHash){
            const ledger=readJson(path.join(runDir,'incremental-pdf-batches.json'),{batches:[]});
            const batch=ledger.batches.find((item)=>item.orderIdHash===currentCombined.orderIdHash);
            if(!batch) throw new Error('增量补单状态存在，但没有找到对应 PDF 批次凭据，已停止。');
            await verifyOutputs(batch.outputs);
            log(`同日增量断点续跑：新增 ${currentCombined.orderCount} 条对应 PDF 已校验，跳过重复导出，直接继续状态变更。`);
            timing.start('order-processing');
            if(rows.length && !incrementalState.lamp?.stateChanged){const changed=await site.changeState(pdfDate,manifest.orderIdHash,{pageType:'lamp'}); incrementalState.lamp.stateChanged=true; incrementalState.lamp.changedCount=changed;}
            if(tabletRows.length && !incrementalState.tablet?.stateChanged){const changed=await site.changeState(pdfDate,tabletManifest.orderIdHash,{pageType:'tablet'}); incrementalState.tablet.stateChanged=true; incrementalState.tablet.changedCount=changed;}
            timing.end();
            incrementalState.stateChanged=true; incrementalState.changedCount=Number(incrementalState.lamp?.changedCount||0)+Number(incrementalState.tablet?.changedCount||0); incrementalState.changedAt=new Date().toISOString(); atomic(incrementalStateFile,incrementalState);
            existing.state.lastIncrementalBatch={orderIdHash:incrementalState.orderIdHash,orderCount:incrementalState.orderCount,changedAt:incrementalState.changedAt,outputs:batch.outputs.map((item)=>item.file)}; existing.state.incrementalBatchCount=Number(existing.state.incrementalBatchCount||0)+1; atomic(existing.stateFile,existing.state);
            atomic(path.join(runDir,'online-verification.json'),{schemaVersion:2,businessDate:pdfDate,checkedAt:new Date().toISOString(),localPdfCount:localPdfs.length,blessingPendingCount:0,tabletPendingCount:0,renewalPendingCount:renewal.rows.length,complete:true});
            skipRegularExport=true;
          } else {
            incrementalMode=true;
            log(`同日增量补单：已有 PDF 和完成凭据保持不变；线上新增供灯 ${rows.length} 条、牌位 ${tabletRows.length} 条，本次只导出新增订单，编号从当天现有最大序号继续。`);
          }
        } else log('检测到 PDF 已校验且线上完成状态已经确认；没有重复导出，也没有重复修改。');
      } else {
        if (!rows.length && !tabletRows.length) {
          existing.state = markOnlineCompletionVerified(existing.state,pdfDate,onlineVerification.checkedAt);
          atomic(existing.stateFile,existing.state);
          log('已有 PDF 的凭据、页数与文件哈希均通过，线上供灯和牌位待祈福均为 0；已补记当天完成状态，没有重复修改线上数据。');
        } else {
        const lampState = existing.state.lamp || {orderCount:existing.state.orderCount,orderIdHash:existing.state.orderIdHash,stateChanged:existing.state.stateChanged};
        const tabletState = existing.state.tablet || {orderCount:0,orderIdHash:PrayerSite.manifest([],pdfDate).orderIdHash,stateChanged:true};
        if (!lampState.stateChanged && (rows.length !== lampState.orderCount || manifest.orderIdHash !== lampState.orderIdHash)) throw new Error('线上供灯待祈福订单与已有 PDF 清单不一致，已停止。');
        if (!tabletState.stateChanged && (tabletRows.length !== tabletState.orderCount || tabletManifest.orderIdHash !== tabletState.orderIdHash)) throw new Error('线上牌位待祈福订单与已有 PDF 清单不一致，已停止。');
        if (lampState.stateChanged && rows.length) throw new Error('供灯状态已记录完成，但线上仍存在待祈福订单，已停止。');
        if (tabletState.stateChanged && tabletRows.length) throw new Error('牌位状态已记录完成，但线上仍存在待祈福订单，已停止。');
        log(`检测到 ${localPdfs.length} 个已有 PDF，结构与哈希校验通过；跳过重复导出。`);
        timing.start('order-processing');
        if (!lampState.stateChanged && rows.length) {
          const changed=await site.changeState(pdfDate,lampState.orderIdHash,{pageType:'lamp'});
          lampState.stateChanged=true; lampState.changedCount=changed; lampState.changedAt=new Date().toISOString(); existing.state.lamp=lampState; atomic(existing.stateFile,existing.state);
          log(`已把 ${changed} 条供灯订单修改为祈福中。`);
        }
        if (!tabletState.stateChanged && tabletRows.length) {
          const changed=await site.changeState(pdfDate,tabletState.orderIdHash,{pageType:'tablet'});
          tabletState.stateChanged=true; tabletState.changedCount=changed; tabletState.changedAt=new Date().toISOString(); existing.state.tablet=tabletState; atomic(existing.stateFile,existing.state);
          log(`已把 ${changed} 条牌位订单修改为祈福中。`);
        }
        timing.end();
        existing.state.stateChanged=true; existing.state.changedCount=Number(lampState.changedCount||0)+Number(tabletState.changedCount||0); existing.state.changedAt=new Date().toISOString(); atomic(existing.stateFile,existing.state);
        atomic(path.join(runDir,'online-verification.json'),{schemaVersion:1,businessDate:pdfDate,checkedAt:new Date().toISOString(),localPdfCount:localPdfs.length,blessingPendingCount:0,tabletPendingCount:0,complete:true});
        log(`供灯与牌位状态补处理完成，并复核待祈福为 0。`);
        }
      }
    } if (!skipRegularExport && (!localPdfs.length || resumablePartial || incrementalMode) && (rows.length || tabletRows.length)) {
    atomic(path.join(runDir,'order-manifest.json'),manifest);
    timing.start('pdf-export'); const d=new Date(`${pdfDate}T00:00:00+08:00`); const token=`${d.getMonth()+1}${d.getDate()}`;
    const outputs=[];
    const activeProgressFile=incrementalMode ? incrementalProgressFile : partialReceiptFile;
    const progress=resumablePartial ? partialReceipt : {schemaVersion:2,businessDate:pdfDate,mode:incrementalMode?'incremental':'initial',lampOrderIdHash:manifest.orderIdHash,tabletOrderIdHash:tabletManifest.orderIdHash,complete:false,groups:{}};
    const exportTracked=async(key,group,color,destination,expected) => {
      const prior=progress.groups[key];
      if(prior){
        const verified=await verifyPdf(prior.file || destination);
        if(verified.sha256!==prior.sha256 || verified.bytes!==prior.bytes || verified.pageCount!==prior.pageCount) throw new Error(`断点 PDF 与原校验凭据不一致：${path.basename(destination)}`);
        outputs.push(verified); log(`断点续跑：${path.basename(prior.file || destination)} 已校验，跳过重复导出。`); return verified;
      }
      const value=await site.exportGroup(group,color,destination,expected,pdfDate);
      if(value){progress.groups[key]=value; progress.updatedAt=new Date().toISOString(); atomic(activeProgressFile,progress); outputs.push(value);}
      return value;
    };
    const paperCounts={red:0,yellow:0};
    const paperPath=(paper) => incrementalMode ? nextPaperPath(folder,token,paper) : path.join(folder,`${token}${paper === 'red' ? '红纸' : '黄纸'}${++paperCounts[paper]}.pdf`);
    const exportPaper=async(group,color,paper,expected) => {
      const destination=paperPath(paper);
      const value=await exportTracked(`${group}-${color}`,group,color,destination,expected);
      if(!value) paperCounts[paper]-=1;
    };
    const waterCount = rows.filter((row) => normalizeText(row.productName).includes('供水养净')).length;
    const ordinaryCount = rows.length - waterCount;
    if(args['recover-water-pdf'] && !progress.groups['water-0']){
      if(!waterCount) throw new Error('当前供灯清单没有供水订单，不能接管供水 PDF。');
      const recovered=await verifyPdf(path.resolve(args['recover-water-pdf']));
      const destination=incrementalMode ? nextWaterPath(folder,token) : path.join(folder,`${token}供水.pdf`);
      if(fs.existsSync(destination)) throw new Error(`供水 PDF 目标已存在，拒绝覆盖：${destination}`);
      fs.copyFileSync(recovered.file,destination);
      const verified=await verifyPdf(destination);
      progress.groups['water-0']=verified; progress.recoveredAt=new Date().toISOString(); atomic(activeProgressFile,progress);
      log(`已接管上次下载但未归档的供水 PDF：${path.basename(destination)}，${verified.pageCount}页；不会重复点击导出。`);
    } else atomic(activeProgressFile,progress);
    if (rows.length) {
      await site.queryLamp(pdfDate);
      await exportTracked('water-0','water','0',incrementalMode ? nextWaterPath(folder,token) : path.join(folder,`${token}供水.pdf`),waterCount);
      await exportPaper('ordinary','0','red',ordinaryCount);
      await exportPaper('ordinary','1','yellow',ordinaryCount);
    }
    const redTabletRows=await site.queryTabletGroup(pdfDate,'长生禄位','长生位模板');
    await exportPaper('tablet-red','0','red',redTabletRows.length);
    const yellowTabletRows=await site.queryTabletGroup(pdfDate,'往生莲位','往生位模板');
    await exportPaper('tablet-yellow','1','yellow',yellowTabletRows.length);
    const exportedTabletIds=[...redTabletRows,...yellowTabletRows];
    const exportedTabletManifest=PrayerSite.manifest(exportedTabletIds,pdfDate);
    if(exportedTabletManifest.orderIdHash!==tabletManifest.orderIdHash || exportedTabletIds.length!==tabletRows.length) throw new Error('牌位红黄分组与初始牌位清单不一致，状态不会改变。');
    timing.end();
    if (!outputs.length) throw new Error('没有生成任何 PDF，状态不会改变。');
    const combinedManifest=PrayerSite.manifest([...rows,...tabletRows],pdfDate);
    progress.complete=true; progress.completedAt=new Date().toISOString(); atomic(activeProgressFile,progress);
    timing.start('pdf-finalize'); const receipt={schemaVersion:3,businessDate:pdfDate,mode:incrementalMode?'incremental':'initial',orderIdHash:combinedManifest.orderIdHash,orderCount:combinedManifest.orderCount,lamp:manifest,tablet:tabletManifest,outputs,verifiedAt:new Date().toISOString()};
    if(incrementalMode){
      const ledgerFile=path.join(runDir,'incremental-pdf-batches.json');
      const ledger=readJson(ledgerFile,{schemaVersion:1,businessDate:pdfDate,batches:[]});
      if(!ledger.batches.some((batch)=>batch.orderIdHash===receipt.orderIdHash)) ledger.batches.push(receipt);
      atomic(ledgerFile,ledger);
    } else atomic(path.join(runDir,'pdf-receipt.json'),receipt);
    timing.count('pdf_page_count',outputs.reduce((n,x)=>n+x.pageCount,0)); timing.end();
    const inbox = ensurePhotoInbox(folder); if (inbox.created) log(`PDF 已校验，已建立当天原始照片目录：${inbox.photoInbox}`);
    const activeStateFile=incrementalMode ? path.join(runDir,'incremental-current-state.json') : path.join(runDir,'run-state.json');
    atomic(activeStateFile,{pdfDate,mode:incrementalMode?'incremental':'initial',inspected:true,pdfVerified:true,quantityApplied:false,stateChanged:false,orderIdHash:combinedManifest.orderIdHash,orderCount:combinedManifest.orderCount,lamp:{orderIdHash:manifest.orderIdHash,orderCount:rows.length,stateChanged:false},tablet:{orderIdHash:tabletManifest.orderIdHash,orderCount:tabletRows.length,stateChanged:false},verifiedAt:new Date().toISOString()});
    timing.start('quantity'); const batchTotals=calculateQuantities(rows); const priorSummary=incrementalMode ? readJson(path.join(runDir,'quantity-summary.json'),{totals:{nine:0,three:0,one:0,water:0}}) : {totals:{nine:0,three:0,one:0,water:0}}; const totals={nine:Number(priorSummary.totals?.nine||0)+batchTotals.nine,three:Number(priorSummary.totals?.three||0)+batchTotals.three,one:Number(priorSummary.totals?.one||0)+batchTotals.one,water:Number(priorSummary.totals?.water||0)+batchTotals.water}; const message=venueMessage(totals); fs.writeFileSync(path.join(runDir,'quantity-message.txt'),message,'utf8'); atomic(path.join(runDir,'quantity-summary.json'),{totals,message,updatedAt:new Date().toISOString()}); const quantityState=readJson(activeStateFile,{}); quantityState.quantityApplied=true; atomic(activeStateFile,quantityState); timing.end();
    log('PDF 已全部校验，正在按同一订单清单修改状态。'); log(message);
    timing.start('order-processing');
    const completedState=JSON.parse(fs.readFileSync(activeStateFile,'utf8'));
    if(rows.length){const changed=await site.changeState(pdfDate,manifest.orderIdHash,{pageType:'lamp'}); completedState.lamp.stateChanged=true; completedState.lamp.changedCount=changed; completedState.lamp.changedAt=new Date().toISOString(); atomic(activeStateFile,completedState); log(`已把 ${changed} 条供灯订单修改为祈福中。`);}
    else completedState.lamp.stateChanged=true;
    if(tabletRows.length){const changed=await site.changeState(pdfDate,tabletManifest.orderIdHash,{pageType:'tablet'}); completedState.tablet.stateChanged=true; completedState.tablet.changedCount=changed; completedState.tablet.changedAt=new Date().toISOString(); atomic(activeStateFile,completedState); log(`已把 ${changed} 条牌位订单修改为祈福中。`);}
    else completedState.tablet.stateChanged=true;
    timing.end();
    completedState.stateChanged=true; completedState.changedCount=Number(completedState.lamp.changedCount||0)+Number(completedState.tablet.changedCount||0); completedState.changedAt=new Date().toISOString(); atomic(activeStateFile,completedState);
    if(incrementalMode){const baseState=readJson(path.join(runDir,'run-state.json'),{}); baseState.lastIncrementalBatch={orderIdHash:completedState.orderIdHash,orderCount:completedState.orderCount,changedAt:completedState.changedAt,outputs:outputs.map((item)=>item.file)}; baseState.incrementalBatchCount=Number(baseState.incrementalBatchCount||0)+1; atomic(path.join(runDir,'run-state.json'),baseState);}
    atomic(path.join(runDir,'online-verification.json'),{schemaVersion:1,businessDate:pdfDate,checkedAt:new Date().toISOString(),localPdfCount:outputs.length,blessingPendingCount:0,tabletPendingCount:0,complete:true});
    log(`${incrementalMode?'同日增量补单完成：':'流程完成：'}供灯 ${rows.length} 条、牌位 ${tabletRows.length} 条均已修改为祈福中，并复核待祈福为 0。`);
    }
    if(!rows.length && !tabletRows.length && renewal.rows.length) log('目标日期没有常规待祈福订单，本次直接执行续费 PDF 闭环。');
    if(!rows.length && !tabletRows.length && !renewal.rows.length && !localPdfs.length) throw new Error('目标日期没有待祈福订单，也没有未处理续费。');
    await exportRenewals(site,runDir,folder,pdfDate,renewal.rows,renewal.manifest,timing,log,{recoverRedPdf:args['recover-renewal-red-pdf'],recoverYellowPdf:args['recover-renewal-yellow-pdf']});
    } else throw new Error(`未知操作：${args.action}`);
  }
  await site.close(); timing.finish(); process.exit(0);
} catch (error) {
  // 先把原始错误写到界面日志。即使计时文件或浏览器清理再次失败，用户也能看到真正原因。
  fail(cleanErrorMessage(error));
  const failedPhase = timing.current?.phase ?? null;
  try {
    if (timing.current) timing.end('failed',String(error.message).slice(0,80));
    timing.event('blocked',failedPhase,0);
  } catch (timingError) {
    fail(`计时日志写入失败：${timingError.message}`);
  }
  if (site) await site.close().catch((closeError)=>fail(`关闭浏览器失败：${closeError.message}`));
  try { timing.finish(); } catch (timingError) { fail(`计时审计写入失败：${timingError.message}`); }
  process.exit(1);
}
