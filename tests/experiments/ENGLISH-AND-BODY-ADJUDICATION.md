# English compatibility and body adjudication investigation

2026-09-11; engineering evidence, **not a release or annual acceptance**.
Production baseline: `b486ec0`. No production recognition change is adopted
by this investigation. The upright-pixel helper remains in `tests/experiments`.

## Fixed-code-crop alternatives

The same 16 historical code-bearing photos and 64 retained detector crops
were tested. Neither filenames nor PDF candidate numbers selected the crops.

| Candidate | Actual result | Decision |
| --- | --- | --- |
| Tesseract legacy mode | 64 reads completed in 7.246 seconds; fewer complete codes and some confidently wrong codes | Rejected |
| Bundled model, height 48 | 64 reads completed in 5.870 seconds; some recoveries, other controls regressed or acquired foreign prefixes | Rejected as a replacement |
| Bundled model, height 64 | 64 reads completed in 6.075 seconds; mixed gains and regressions | Rejected as a replacement |
| Official float precision model with full core | Runtime missing-function abort; no completed accuracy comparison | Not adopted |
| TrOCR public model download | Metadata/configuration connections timed out; no model inference occurred | Accuracy unknown |

These are bounded diagnostic runs, not independent business successes or
newly completed orders. Reusing a different Tesseract mode is not a third
independent engine. No global threshold was relaxed to pass the sample.

## Actual current-PDF body evidence

Read every one of the 16 physical pages in four source PDFs and all 16
code-bearing photos through the existing Chinese body reader. Four views
per image were collected, with PDF content hashes and physical page indices.
The run completed in 138.275 seconds, without external network/process calls
or original-file changes. Raw customer text and reports remain private.

- 14 photos had one paired, page-specific body candidate, with no other
  page-specific candidate from the existing text/field rules.
- Those 14 include five of the seven unresolved code cases.
- The two remaining cases are portrait tablets. **Their names were already
  readable in both original vertical views of both photo and PDF.** The
  names also occur elsewhere in the day's PDF corpus, so a name by itself is
  not page-specific evidence.
- A body candidate is not a verified order binding. All seven code cases
  remain unresolved; no number was supplied from a highest score or gap.

The relevant structural gaps are separate from OCR availability:

1. `summarizeDetectedCodeRead` retains contrary raw strings, including weak
   ones; `recognizePreparedImage` returns on those conflicts.
2. `retainDetectedCodeRead` records them in the audit history.
3. `reviewCurrentPdfBodies` currently reviews only surviving numeric claims
   and is veto-only. Consequently it cannot adjudicate the five unresolved
   cases even when their body observations are page-specific.
4. `createBodyFieldComparator` uses individual field uniqueness. Repeated
   names cannot become identities merely because they were read correctly.

The next implementation must distinguish weak alternatives from established
contradictions, require source-bound positive content evidence and preserve
raw observations. It must not delete audit history, adopt a body rank as an
order, merge unrelated fields or use expected missing numbers as answers.
Identical bodies and repeated customers remain explicit negative cases.

## Rejected upright-glyph experiment

`upright-vertical-line.mjs` moves upright glyph pixel groups into a horizontal
line without rotating individual glyphs. It has no text, PDF, filename or
expected-number input. Pixel-copy and safety tests are retained so the
experiment is reproducible, not to authorize production use.

A bounded vertical-only probe processed 86 candidate crops over the same
16 PDF pages and 16 photos: 29 could be segmented, 28 were read above the
existing threshold, in 38.198 seconds. A temporary production integration
was then tested on all 32 images, completing in 162.703 seconds. Some tests
ran concurrently, so the two timings are not a controlled speed benchmark.

The full A/B comparison verified:

- 64 original horizontal-view texts unchanged;
- 64 original rotated-view texts retained unchanged;
- zero changes to the paired body-candidate sets;
- both tablet names already present in all eight relevant old observations;
- **zero newly readable tablet names, zero added order bindings, zero cleared
  code conflicts**;
- unchanged source hashes and zero external calls.

An initial check assumed the tablet names had been unreadable and FAILED.
Inspection of the original observations disproved that assumption. The
candidate production path and its Windows integration hook were removed.
This is a rejected hypothesis, not an accuracy repair. Do not reinstate it
as a fix without new independent held-out evidence of benefit.

The temporary integration passed the 198 ordinary Node tests and full
Windows suite, including a synthetic upright-text check. That does not turn
its zero observed accuracy gain into a product improvement. Production
source is restored to the baseline. Final regression on that state passed:
198 Node tests, zero failures/skips; pixel-line regression; full Windows
process/UI, long-path OCR, Chinese model, cache and local-browser checks.

## Remaining acceptance

Seven full-code cases still need real adjudication and full-plan validation.
Final frozen annual replay, cross-computer acceptance, release tags and
deployment have not happened. The tests here do not change that status.
