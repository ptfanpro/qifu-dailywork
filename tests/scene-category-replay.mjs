// Category/capacity A/B only. Historical scene labels select the test corpus,
// not the answers. This does not test paper-vs-scene entry or order binding.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {requirePrivateAuditRoot} from './audit-paths.mjs';
import {recognitionSourceFingerprint} from '../src/recognition-provenance.mjs';
import {classifyScenes} from '../src/photo-prepare.mjs';

const [privateRoot, baselineRoot, ...dates] = process.argv.slice(2);
if (!privateRoot || !baselineRoot) throw Error('PRIVATE_OUTPUT BASELINE_SOURCE [YYYY-MM-DD ...]');
const root = requirePrivateAuditRoot(privateRoot), baseline = fs.realpathSync(baselineRoot);
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const within = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};
if (!within(root, baseline) || baseline === source) throw Error('Baseline must be a separate frozen private snapshot');
const old = (await import(pathToFileURL(path.join(baseline, 'src', 'photo-prepare.mjs')))).classifyScenes;
const sourceHash = recognitionSourceFingerprint(source), baselineHash = recognitionSourceFingerprint(baseline);
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'inventory.json')));
const selected = inventory.days.filter(day => !dates.length || dates.includes(day.date));
if (new Set(dates).size !== dates.length || dates.some(date => !selected.some(day => day.date === date))) throw Error('Unknown or duplicate date');
const output = fs.mkdtempSync(path.join(root, 'scene-category-replay-'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const checked = (photo, day) => {
  if (!/^2026-\d{2}-\d{2}$/.test(day.date) || path.basename(day.folder) !== `${Number(day.date.slice(5,7))}月${Number(day.date.slice(8))}日`
    || fs.lstatSync(day.folder).isSymbolicLink() || fs.lstatSync(day.photoDir).isSymbolicLink()
    || fs.lstatSync(photo.file).isSymbolicLink()
    || fs.realpathSync(path.dirname(photo.file)) !== fs.realpathSync(day.photoDir)
    || fs.realpathSync(day.photoDir) !== path.join(fs.realpathSync(day.folder), '1')
    || sha(photo.file) !== photo.sha256) throw Error('Scene input identity changed');
};
const rows = [], started = Date.now();
try {
  for (const day of selected) {
    const photos = day.photos.filter(photo => /^scene-(lamp|water)$/.test(photo.referenceLabel));
    if (!photos.length) continue;
    const input = path.join(output, day.date); fs.mkdirSync(input);
    const mappings = photos.map((photo, index) => {
      checked(photo, day);
      const blind = path.join(input, `${photo.sha256}-${index}${path.extname(photo.file)}`);
      fs.copyFileSync(photo.file, blind);
      if (sha(blind) !== photo.sha256) throw Error('Scene copy identity changed');
      return {photo, blind};
    });
    const scenarios = [{mode: 'batch-empty', mappings, occupied: []}];
    for (const mapping of mappings) for (const [mode, occupied] of [
      ['single-empty', []], ['single-lamps-full', ['2.1.jpg', '2.2.jpg']], ['single-water-full', ['2.5.jpg', '2.6.jpg']],
    ]) scenarios.push({mode, mappings: [mapping], occupied});
    const outcomes = [];
    for (const scenario of scenarios) {
      const result = {mode: scenario.mode, occupied: scenario.occupied, photoHashes: scenario.mappings.map(x => x.photo.sha256)};
      for (const [name, classifier] of [['baseline', old], ['candidate', classifyScenes]]) {
        const value = await classifier(scenario.mappings.map(x => x.blind), new Set(scenario.occupied));
        result[name] = {issues: value.issues.length, assignments: value.assignments.map(item => ({
          photoSha256: scenario.mappings.find(x => x.blind === item.source).photo.sha256,
          kind: item.kind, targetName: item.targetName, method: item.evidence?.method,
        }))};
      }
      outcomes.push(result);
    }
    for (const photo of photos) checked(photo, day);
    const row = {date: day.date, photos: photos.length, sourceUnchanged: true, outcomes};
    fs.writeFileSync(path.join(input, 'report.json'), JSON.stringify(row, null, 2)); rows.push(row);
    console.log(JSON.stringify({date: day.date, photos: photos.length, scenarios: scenarios.length, status: 'category-only-not-acceptance'}));
  }
  if (sourceHash !== recognitionSourceFingerprint(source) || baselineHash !== recognitionSourceFingerprint(baseline)) throw Error('Source snapshot changed');
  const summary = {status: 'category-only-not-acceptance', sourceHash, baselineHash, dates: rows.length,
    photos: rows.reduce((n, r) => n + r.photos, 0), scenarios: rows.reduce((n, r) => n + r.outcomes.length, 0),
    sourceUnchanged: true, seconds: (Date.now() - started) / 1000,
    note: 'Filename labels select scenes only; blind inputs. No OCR, paper entry, order binding, renaming, upload or business mutation.'};
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({privateOutput: output, ...summary}));
} catch (error) {
  fs.writeFileSync(path.join(output, 'failed.json'), JSON.stringify({status: 'failed-not-acceptance', errorType: error.name, completedDates: rows.length}));
  throw error;
}
