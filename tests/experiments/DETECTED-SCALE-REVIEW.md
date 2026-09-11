# Bounded whole-frame scale review (production code, not a released version)

2026-09-11. Development follow-up to `PAPER-REGION-READING.md`.

## Defect and scope

A complete, consistent Paddle code with insufficient independent Tesseract
support returned `detected-code-unconfirmed`. The dispatcher correctly refused
to use legacy guesses, but no further content-located reading could recover it.
Real full-frame detector crops differed by a few pixels from region-local
crops. A fixed larger whole-frame detection scale recovered independent
support without adding a visual model or using a PDF answer to choose a crop.

`readDetectedCodesWithScaleReview` now preserves the original reading and adds
at most one full-frame `maxSide=2048` pass. It applies only after the existing
bounded local reviews have completed, on images larger than the original
1536 limit, with complete coverage, one consistent business-prefix code and
two confident Paddle paddings, but inadequate independent support. Existing
successes, original conflicts/fragments/errors and small images do not retry.

The original and supplemental observations remain separate. Both read the
same source bytes; dimensions and the original raw-evidence digest are bound.
The supplemental pass must independently meet the existing two-engine and
two-padding requirements, and cannot suppress original or newly observed
conflicts. Failed or blank extra reads remain failures. PDF/body/duplicate and
upload gates are unchanged. A detector scale is not another OCR engine.

Both new-photo and existing-number recheck paths use the wrapper. The raw
observation cache retains both passes across restart, validates both, and
removes derived confirmation values rather than caching an order decision.

## Actual validation

- First tested a fixed 10-pixel white border at 96-pixel OCR height: no complete
  code on the four selected controls/hard examples. Rejected, not integrated.
- A requested standalone Windows OCR probe did not run: execution approval
  failed with an approval-service connection error. It was not retried via
  another route. No Windows evidence from that probe supports this change.
- The larger-scale, non-Windows five-photo probe reproduced one new independent
  code confirmation. Three remaining hard paper examples were not recovered.
- New regression tests first failed due to the missing implementation. Five
  tests now cover gating, original retention, supplement conflicts/failures,
  source/dimension/recipe/digest validity, and cache resume/conflict retention.
- Full Windows regression: 178 ordinary tests, no skipped tests, and actual
  process/UI, synthetic Windows OCR, OCR models/caches and local browser
  integration passed (exit 0). This was separately approved test execution;
  it did not run the refused customer-image Windows diagnostic.
- Actual current production-reader/dispatcher validation: 18 original photos
  (all 16 from one explicit historical date plus two other-date hard examples).
  Seven received the bounded extra pass. Confirmed code proposals rose from
  6 to 8: two gains, zero losses, zero number remaps, 92.558 seconds. Original
  bytes and recognition-source hashes were rechecked unchanged. No Windows
  customer-image OCR or network calls were made in this validation.
- Visual review found each of the two extra code proposals consistent with
  its corresponding photo/PDF page. This is not automatic all-page uniqueness
  or online order-binding acceptance.

The tested working-tree recognition fingerprint is
`345efb8dba27eb87ac128b527bc88f0fcefd2715029a7c5c2d58f8170244a23b`.
Private photos, rendered pages, raw observations, timing and runtime paths
are not committed. Development timing includes analysis/implementation and
must not be presented as an operational daily SLA sample.

## Not finished

This has not been replayed through the complete planner across the full
historical dataset. Code proposals are not business assignments. The remaining
hard code cases and three production scene-semantic counterexamples still
fail; the latter were rerun and returned exit 1. No release gate was removed,
no version number/tag created, no launcher/default date/login changed, and
no original photo, production order or deployed software was modified.
