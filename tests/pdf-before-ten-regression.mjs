import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Exercise the actual runner with a frozen Beijing clock. Isolate local state
// and stop at browser entry so this test cannot touch live orders or files.
const appRoot=fileURLToPath(new URL('../',import.meta.url));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-pdf-before-ten-'));
const guard=path.join(temp,'guard.mjs'),marker=path.join(temp,'browser-entry.json');
const runtimeUrl=pathToFileURL(path.join(appRoot,'src/runtime-paths.mjs')).href;
const siteUrl=pathToFileURL(path.join(appRoot,'src/site.mjs')).href;
const businessRoot=path.join(temp,'business');
fs.mkdirSync(businessRoot);
fs.writeFileSync(guard,`
import {registerHooks} from 'node:module';
import fs from 'node:fs';
const RealDate=Date;
const frozen=RealDate.parse(process.env.QIFU_TEST_CLOCK);
globalThis.Date=class extends RealDate {
  constructor(...args){super(...(args.length?args:[frozen]));}
  static now(){return frozen;}
};
registerHooks({load(url,context,next){
  if(url===${JSON.stringify(runtimeUrl)})return {format:'module',shortCircuit:true,source:${JSON.stringify(`export function getMachineLocalStateRoot(){return ${JSON.stringify(path.join(temp,'state'))};}`)}};
  return next(url,context);
}});
const {PrayerSite}=await import(${JSON.stringify(siteUrl)});
PrayerSite.prototype.open=async function(){
  fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({runDir:this.runDir,beijingHour:Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',hour:'2-digit',hour12:false}).format(new Date()))}));
  throw new Error('PDF_TEST_BROWSER_STOP');
};
PrayerSite.prototype.close=async function(){};
`);
try {
  for(const [clock,hour] of [['2026-10-02T01:00:00Z',9],['2026-10-01T16:30:00Z',0],['2026-10-02T02:00:00Z',10]]){
    fs.rmSync(marker,{force:true});
    const result=spawnSync(process.execPath,['--import',pathToFileURL(guard).href,path.join(appRoot,'src/runner.mjs'),'export','--root',businessRoot,'--pdf-date','2026-10-02'],{env:{...process.env,QIFU_TEST_CLOCK:clock},encoding:'utf8',timeout:20000,windowsHide:true});
    assert.equal(result.error,undefined);
    assert.match(result.stderr,/PDF_TEST_BROWSER_STOP/,`Beijing ${hour}:00 must reach the normal export workflow, not a time refusal`);
    const entered=JSON.parse(fs.readFileSync(marker,'utf8'));
    assert.equal(entered.beijingHour,hour);
    assert.equal(path.basename(entered.runDir),'2026-10-02','explicit business date must be preserved');
  }
  fs.rmSync(marker,{force:true});
  const missingDate=spawnSync(process.execPath,['--import',pathToFileURL(guard).href,path.join(appRoot,'src/runner.mjs'),'export','--root',businessRoot],{env:{...process.env,QIFU_TEST_CLOCK:'2026-10-02T01:00:00Z'},encoding:'utf8',timeout:20000,windowsHide:true});
  assert.equal(missingDate.status,2);
  assert.match(missingDate.stderr,/缺少 PDF 业务日期/);
  assert.equal(fs.existsSync(marker),false,'missing date must stop before browser entry');
  console.log('PDF export before ten regression PASS: Beijing 00:30, 09:00 and 10:00; explicit date retained');
} finally {fs.rmSync(temp,{recursive:true,force:true});}
