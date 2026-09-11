import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function requirePrivateAuditRoot(root) {
  // Evidence contains private material. Only an existing dedicated child of
  // this user's local temporary directory may hold generated audit evidence.
  const resolved=fs.realpathSync(root),temporary=fs.realpathSync(os.tmpdir());
  const relative=path.relative(temporary,resolved);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!fs.statSync(resolved).isDirectory())throw Error('Audit output must be a dedicated existing local temporary directory');
  // A frozen portable application can itself live under TEMP. Keep evidence
  // outside that source snapshot as well; cwd may be unrelated to the app.
  const application=fs.realpathSync(fileURLToPath(new URL('..',import.meta.url)));
  const inApp=path.relative(application,resolved);
  if(!inApp||(!inApp.startsWith('..'+path.sep)&&inApp!=='..'&&!path.isAbsolute(inApp)))
    throw Error('Audit evidence must be outside the application snapshot');
  return resolved;
}
