// Summarize evidence availability, never recognition accuracy or assignment.
// No source paths, customer text, historical labels or target numbers are used.
const views = ['chinese-detected-0.35', 'chinese-detected-0.65'];
const hash = value => /^[a-f0-9]{64}$/.test(value || '');
const samePage = (a, b) => a.pdfSha256 === b.pdfSha256 && a.pageNumber === b.pageNumber;

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
    const readings = views.map(view => (report.results || []).filter(reading => reading.view === view));
    let state;
    if (readings.some(matches => matches.length !== 1)) state = 'incomplete-reader-evidence';
    const selected = readings.map(matches => matches[0]);
    if (!state && selected.some(r => r.readerAvailable !== true || r.batchErrorCount !== 0 || r.truncated !== false)) {
      state = 'incomplete-reader-evidence';
    }
    if (!state && selected.some(r => !Number.isInteger(r.totalPages) || r.totalPages < 1 || r.textBearingPages !== r.totalPages)) {
      state = 'incomplete-pdf-text';
    }
    const tops = selected.map(r => r?.ranked?.[0]);
    if (!state && selected.some((r, i) => !tops[i] || !hash(tops[i].pdfSha256)
      || !Number.isInteger(tops[i].pageNumber) || tops[i].pageNumber < 1)) throw Error('Missing ranked page identity');
    if (!state && tops.every(top => top.uniqueMatchedGrams === 0)) state = 'no-unique-body-evidence';
    if (!state && selected.every((r, i) => r.topUniqueTieCount === 1
      && Number.isInteger(tops[i].uniqueMatchedGrams) && tops[i].uniqueMatchedGrams > 0)
      && samePage(tops[0], tops[1]) && selected[0].totalPages === selected[1].totalPages) {
      state = 'stable-diagnostic-candidate';
    }
    state ||= 'ambiguous-or-disagreeing-views';
    outcomes.push({date: report.date, photoSha256: report.photoSha256, state});
  }
  const counts = {};
  for (const outcome of outcomes) counts[outcome.state] = (counts[outcome.state] || 0) + 1;
  return {schemaVersion: 1, status: 'diagnostic-only-not-binding', sourceFingerprint: fingerprint,
    modelSha256: model, photos: outcomes.length, counts, outcomes,
    note: 'A stable candidate is not proof of complete page/order binding. Two views are one engine. No automatic assignments.'};
}
