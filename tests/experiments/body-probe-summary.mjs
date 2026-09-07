// Summarize evidence availability, never recognition accuracy or assignment.
// No source paths, customer text, historical labels or target numbers are used.
const layoutViews = {horizontal: ['chinese-detected-0.35', 'chinese-detected-0.65'],
  vertical: ['chinese-vertical-0.35', 'chinese-vertical-0.65']};
const hash = value => /^[a-f0-9]{64}$/.test(value || '');
const samePage = (a, b) => a.pdfSha256 === b.pdfSha256 && a.pageNumber === b.pageNumber;

function inspectLayout(report, layout) {
  const readings = layoutViews[layout].map(view => (report.results || []).filter(r => r.view === view));
  if (readings.some(matches => matches.length !== 1)) return {state: 'incomplete-reader-evidence'};
  const selected = readings.map(matches => matches[0]);
  if (selected.some(r => r.readerAvailable !== true || r.batchErrorCount !== 0 || r.truncated !== false)) {
    return {state: 'incomplete-reader-evidence'};
  }
  if (selected.some(r => !Number.isInteger(r.totalPages) || r.totalPages < 1 || r.textBearingPages !== r.totalPages)
    || selected[0].totalPages !== selected[1].totalPages) return {state: 'incomplete-pdf-text'};
  for (const reading of selected) {
    const ids = new Set();
    if (!Array.isArray(reading.ranked) || reading.ranked.length !== reading.totalPages) throw Error('Incomplete ranked page set');
    for (const page of reading.ranked) {
      const identity = `${page.pdfSha256}:${page.pageNumber}`;
      if (!hash(page.pdfSha256) || !Number.isInteger(page.pageNumber) || page.pageNumber < 1 || ids.has(identity)
        || !Number.isInteger(page.uniqueMatchedGrams) || page.uniqueMatchedGrams < 0) throw Error('Invalid ranked page evidence');
      ids.add(identity);
    }
    if (reading.ranked.some(page => page.uniqueMatchedGrams > reading.ranked[0].uniqueMatchedGrams)) throw Error('Invalid ranked page order');
  }
  const tops = selected.map(r => r.ranked[0]);
  if (tops.every(top => top.uniqueMatchedGrams === 0)) return {state: 'no-unique-body-evidence'};
  if (selected.some(r => r.ranked.filter(page => page.uniqueMatchedGrams > 0).length > 1)) {
    return {state: 'multi-page-body-evidence'};
  }
  if (selected.every((r, i) => r.topUniqueTieCount === 1 && tops[i].uniqueMatchedGrams > 0) && samePage(...tops)) {
    return {state: 'stable-diagnostic-candidate', candidate: tops[0]};
  }
  return {state: 'ambiguous-or-disagreeing-views'};
}

export function summarizeBodyProbeReports(reports) {
  if (!reports.length) throw Error('No completed body probe reports');
  const fingerprint = reports[0].sourceFingerprint, model = reports[0].modelSha256;
  if (!hash(fingerprint) || !hash(model)) throw Error('Missing frozen code/model identity');
  const identities = new Set(), outcomes = [];
  for (const report of reports) {
    if (report.status !== 'diagnostic-only-not-binding' || report.sourceUnchanged !== true) {
      throw Error('Incomplete or changed-source probe');
    }
    if (report.sourceFingerprint !== fingerprint || report.modelSha256 !== model) throw Error('Mixed code/model rounds');
    if (!/^2026-\d\d-\d\d$/.test(report.date || '') || !hash(report.photoSha256)) throw Error('Missing photo/date identity');
    const identity = `${report.date}:${report.photoSha256}`;
    if (identities.has(identity)) throw Error('Duplicate photo/date report');
    identities.add(identity);
    const layouts = report.expectedLayouts || ['horizontal'];
    if (!Array.isArray(layouts) || !layouts.length || new Set(layouts).size !== layouts.length
      || layouts.some(layout => !Object.hasOwn(layoutViews, layout))) throw Error('Invalid expected layout set');
    const evidence = layouts.map(layout => ({layout, ...inspectLayout(report, layout)}));
    const expectedViews = layouts.flatMap(layout => layoutViews[layout]);
    const pageSets = (report.results || []).filter(r => expectedViews.includes(r.view) && Array.isArray(r.ranked))
      .map(r => r.ranked.map(p => `${p.pdfSha256}:${p.pageNumber}`).sort().join('\n'));
    if (pageSets.length === expectedViews.length && new Set(pageSets).size !== 1) throw Error('Inconsistent ranked page set');
    const candidates = evidence.filter(e => e.candidate);
    let state = ['incomplete-reader-evidence', 'incomplete-pdf-text', 'multi-page-body-evidence',
      'ambiguous-or-disagreeing-views'].find(value => evidence.some(e => e.state === value));
    if (!state && candidates.length > 1 && candidates.some(e => !samePage(e.candidate, candidates[0].candidate))) {
      state = 'conflicting-layout-evidence';
    }
    state ||= candidates.length ? 'stable-diagnostic-candidate' : 'no-unique-body-evidence';
    outcomes.push({date: report.date, photoSha256: report.photoSha256, state,
      layoutStates: Object.fromEntries(evidence.map(e => [e.layout, e.state]))});
  }
  const counts = {};
  for (const outcome of outcomes) counts[outcome.state] = (counts[outcome.state] || 0) + 1;
  return {schemaVersion: 2, status: 'diagnostic-only-not-binding', sourceFingerprint: fingerprint,
    modelSha256: model, photos: outcomes.length, counts, outcomes,
    note: 'A stable candidate is not proof of complete page/order binding. Layout/crop views are one engine. No automatic assignments.'};
}
