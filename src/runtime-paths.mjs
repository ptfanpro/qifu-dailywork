import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
let cached;
export function getMachineLocalStateRoot() {
  if(cached) return cached;
  if(process.platform!=='win32') throw new Error('本机执行器运行态只支持 Windows 本地用户目录。');
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('../ui/RuntimePaths.ps1',import.meta.url)),'-PrintRoot'],{windowsHide:true,encoding:'utf8',timeout:15000});
  if(result.error || result.status!==0 || !result.stdout.trim()) throw new Error('无法验证本机非同步运行目录，已停止；不会在程序目录或 NAS 写入运行态。');
  cached=result.stdout.trim();
  return cached;
}
