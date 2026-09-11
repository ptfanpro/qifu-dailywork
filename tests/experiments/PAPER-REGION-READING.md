# Region-guided reading: measured benefit, not a production repair

2026-09-11. Follow-up to `PAPER-REGION-CALIBRATION.md`. No runtime,
launcher, dates, account/login, online state or release version changed.

## What was actually run

The current production planner was replayed from Git snapshot
`74fe2d5b6a98e5e54b4a2b06e69e4844a0fc6d9c` for three explicit dates:

| Date | Photos | PDF pages | Plan assignments | Unresolved |
| --- | ---: | ---: | ---: | ---: |
| 2026-01-25 | 16 | 15 | 6 | 10 |
| 2026-03-04 | 20 | 16 | 9 | 11 |
| 2026-06-02 | 20 | 17 | 14 | 6 |

This is 56 photos / 13 PDF files, not a new full-year acceptance. There was
one difference from a historical numeric filename in the middle date. A
filename is not independent truth; that difference still needs physical-page
review. Source and original hashes were unchanged. Runtime: 1226.947 seconds.
The archive recognition fingerprint is
`effc28051864533fb9300912797a6d3e69fb9c3fa796640489547933d745adff`.
An initial preflight stopped before processing because the checkout used CRLF
and archive LF; all 21 recognition files were checked equal after newline
normalization. The rerun used the archive's actual raw-byte fingerprint.
Production fingerprint/cache validation was NOT relaxed or normalized.

Separately, the calibrated image-only patch outputs proposed two fixed
reading windows for each of five earlier whole-image-model paper abstentions.
Three scene controls produced no paper window. Both existing OCR engines
actually read all ten windows, taking 83.759 seconds. Their complete and
contrary observations, coverage and original-pixel crop coordinates are saved
privately, with source/crop hashes. No expected PDF number selected a window.

## Findings and remaining defects

- One of those five paper examples already passes the frozen current planner;
  it is not a new recovery attributable to this experiment.
- One previously unconfirmed complete code obtains the same full code from
  both engines on both paddings in the larger region window. Whole-frame
  observations remain consistent. Visual comparison of the photo and a PDF
  page found matching code/content. This is ONE extra diagnostic code result,
  not an automatically verified page/order assignment.
- Two other examples still have only one-engine code support. The last example
  has no complete-code observation. Those three are not recovered.
- The successful extra read uses slightly different pixel bounds from the
  downscaled whole-frame detector. This supports localization/crop sensitivity
  as a contributor; it does not establish the cause of every remaining error.
- Zero windows on scene controls is not proof of correct lamp/water semantics.
  The three existing production scene counterexamples still fail (exit 1).

`paper-reading-windows.py` is deliberately an experimental geometry utility.
It accepts explicit oriented dimensions and two connected patch components,
requires spatial overlap, and emits their union with fixed one/two-cell
padding. It rejects malformed cells/dimensions, clips and deduplicates bounds,
and asserts no paper role, code verification, independent views or upload
authority. Small components may locate an extra read; they cannot satisfy or
lower the separate paper-classification acceptance threshold.

## Verification and next boundary

- New geometry regressions: 4/4 (initially failed before implementation).
- Existing patch supervision/calibration Python regressions: 6/6 and 3/3.
- Full Windows development regression: 173 ordinary tests, zero skipped;
  process/UI, real OCR/model/cache and local browser integration passed, exit 0.
- Actual release counterexamples: three failures, exit 1, expectations unchanged.
- No customer images, PDFs, per-photo readings, features, labels, weights or
  runtime state were added to Git. They remain in private temporary evidence.

Before production integration, supplemental observations need append-only
provenance, complete original coverage and conflict preservation, followed by
physical PDF-page/body/order binding. The remaining three code examples and
scene semantic defects still need repair; then replay a single frozen version
across the full historical set. None of the experiments constitute release
acceptance, and no production recognition change is being claimed here.
