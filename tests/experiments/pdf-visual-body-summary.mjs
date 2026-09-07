// Recompute A/B summaries from per-photo reports, not self-reported counters.
import {summarizeBodyProbeReports} from './body-probe-summary.mjs';
const hash = value => /^[a-f0-9]{64}$/.test(value || '');
const identity = page => `${page.pdfSha256}:${page.pageNumber}`;

export function summarizeVisualBodyComparison(completion, pairs) {
  if (completion?.status !== 'diagnostic-only-not-binding' || completion.sourceUnchanged !== true
    || !hash(completion.sourceFingerprint) || !hash(completion.modelSha256)
    || !/^2026-\d\d-\d\d$/.test(completion.date || '')
    || !Number.isInteger(completion.photos) || completion.photos < 1 || !Array.isArray(pairs)
    || pairs.length !== completion.photos || !Number.isInteger(completion.pages) || completion.pages < 1
    || !Array.isArray(completion.pageSummaries) || completion.pageSummaries.length !== completion.pages) {
    throw Error('Incomplete visual body comparison');
  }
  const pages = completion.pageSummaries;
  if (pages.some(p => !hash(p.pdfSha256) || !Number.isInteger(p.pageNumber) || p.pageNumber < 1)
    || new Set(pages.map(identity)).size !== pages.length
    || new Set(pages.map(p => p.pdfSha256)).size !== completion.pdfs) throw Error('Invalid visual PDF page set');
  const expected = pages.map(identity).sort().join('\n');
  for (const pair of pairs) {
    if (pair.textOnly?.photoSha256 !== pair.visual?.photoSha256) throw Error('Mismatched A/B photo');
    for (const report of [pair.textOnly, pair.visual]) {
      if (!report || report.sourceFingerprint !== completion.sourceFingerprint || report.modelSha256 !== completion.modelSha256
        || report.date !== completion.date || report.expectedLayouts?.join(',') !== 'horizontal,vertical'
        || !Array.isArray(report.results)) throw Error('Mismatched visual comparison provenance');
      if (report.results.some(r => !Array.isArray(r.ranked) || r.ranked.map(identity).sort().join('\n') !== expected)) {
        throw Error('Mismatched visual comparison page set');
      }
    }
  }
  const textOnly = summarizeBodyProbeReports(pairs.map(p => p.textOnly));
  const visual = summarizeBodyProbeReports(pairs.map(p => p.visual));
  return {status: 'diagnostic-only-not-binding', date: completion.date, sourceFingerprint: completion.sourceFingerprint,
    modelSha256: completion.modelSha256, photos: pairs.length, pages: pages.length,
    textOnlyCounts: textOnly.counts, visualCounts: visual.counts,
    note: 'Visible-PDF supplementation is experimental; candidate availability is not verified order binding.'};
}
