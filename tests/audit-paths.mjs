import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function requirePrivateAuditRoot(root) {
  // Evidence contains private material. Only an existing dedicated child of
  // this user's local temporary directory may hold generated audit evidence.
  const resolved=fs.realpathSync(root),temporary=fs.realpathSync(os.tmpdir());
  const relative=path.relative(temporary,resolved);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!fs.statSync(resolved).isDirectory())throw Error('Audit output must be a dedicated existing local temporary directory');
  return resolved;
}
