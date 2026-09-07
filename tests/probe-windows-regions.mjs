// Private, read-only spatial OCR probe. Stdout includes only code-like tokens.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),sharp=require('sharp');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-region-probe-'));
for(const [i,file] of process.argv.slice(2).entries()) {
  const copy=path.join(dir,`${i}.png`);
  await sharp(fs.readFileSync(file)).rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:false}).png().toFile(copy);
  const list=path.join(dir,`${i}.txt`);fs.writeFileSync(list,copy);
  const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('ui/Read-WindowsOcr.ps1'),'-InputListPath',list,'-IncludeRegions'],{encoding:'utf8',windowsHide:true,timeout:30000});
  fs.writeFileSync(path.join(dir,`${i}.jsonl`),result.stdout||'');
  for(const line of (result.stdout||'').trim().split(/\r?\n/)) {
    if(!line) continue;
    const row=JSON.parse(line);
    console.log(JSON.stringify({sample:i,status:row.status,lines:row.lines?.length,
      numericLines:(row.lines||[]).map(l=>l.text.replace(/[^\d\s-]/g,'')).filter(s=>/26\d\s*-?\s*1\s*-/.test(s))}));
  }
}
