import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repoRoot=fileURLToPath(new URL('..',import.meta.url));
const stages=Object.freeze([
  Object.freeze({id:'scene-semantics',command:process.execPath,args:['tests/experiments/scene-semantic-counterexamples.mjs'],timeoutMs:120000}),
  Object.freeze({id:'layout-runtime-assets',command:process.execPath,args:['tests/layout-runtime-integration.mjs',path.join(repoRoot,'runtime','layout-python-v1')],timeoutMs:300000}),
  Object.freeze({id:'positioned-code-join',command:process.execPath,args:['tests/positioned-join-integration.mjs',repoRoot],timeoutMs:120000}),
  Object.freeze({id:'windows-full-suite',command:'powershell.exe',args:['-NoProfile','-File','ui/Run-Tests.ps1'],timeoutMs:600000}),
]);

function executeStage(stage){
  return new Promise(resolve=>{
    const child=spawn(stage.command,stage.args,{
      cwd:repoRoot,windowsHide:true,stdio:'inherit',timeout:stage.timeoutMs,
    });
    child.once('error',()=>resolve({status:null}));
    child.once('close',(status,signal)=>resolve({status,signal}));
  });
}

// Code tests are necessary, but never substitute for the frozen annual replay,
// exact order binding and explicitly authorized online acceptance evidence.
export async function runReleaseGates({platform=process.platform,run=executeStage}={}){
  const checked=[];
  const fail=failedStage=>({passed:false,releaseAccepted:false,failedStage,checked});
  if(platform!=='win32')return fail('windows-required');
  for(const stage of stages){
    let result;
    try{result=await run(stage);}catch{return fail(stage.id);}
    if(result?.status!==0||result.signal)return fail(stage.id);
    checked.push(stage.id);
  }
  return {passed:true,releaseAccepted:false,failedStage:null,checked};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const result=await runReleaseGates();
  console.log(JSON.stringify(result));
  console.log(result.passed
    ?'代码发布检查通过；全年回放、逐页订单归属及线上验收仍需独立通过，当前结果不授权发布。'
    :'发布检查失败：禁止将当前源码标为已通过发布验收。');
  process.exitCode=result.passed?0:1;
}
