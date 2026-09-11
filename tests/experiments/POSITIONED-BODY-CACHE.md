# Position-required body observation cache

2026-09-12. Follow-up to `06318e3`; not an annual acceptance run or release.

## Reproduction and fix

The body reader can now return field positions, but its observation cache did
not distinguish that output from legacy text-only output. Two regression tests
failed before this fix: a position-required request reused the text-only cache,
and a checksummed but malformed position payload was accepted.

`readBodyObservation` now accepts an explicit `positioned-v1` profile with a
separate content-addressed key. Default `text-v1` keys and behavior are unchanged.
Missing or inconsistent position metadata invalidates the cache. An invalid
fresh position-required read throws rather than returning apparent success.
No cache files are globally deleted, and no page/order decisions are cached.

The position validator checks four complete views, consistent image dimensions,
detector region identities, per-layout counts/limits, ordered unique indices,
confidence, transcript equality and exact recomputed horizontal/vertical crops.
Empty or single-view-missing fields remain valid observations, not page matches.
The validator is included in the recognition source fingerprint.

## Verification

- Two reproduction tests failed before the implementation and pass afterward.
- Three new test cases, including malformed metadata, geometry, limits and
  legacy cache coexistence, are in the ordinary test entry point.
- Final full Windows suite passed: 201 ordinary Node tests, plus process/UI,
  DPAPI, actual OCR/model/cache and four local browser cases; no skipped tests.
- The previous real read's 16 PDF pages and 16 code-bearing photos (128 views)
  all pass the new structural validator. This reused saved observations; it is
  **not new OCR, a new complete photo plan, or an independent accuracy run**.
- Tested source fingerprint:
  `5f2a1fb5646c51f2d6006404ae7a3702e439a322b1010e03ca23a6007d92cfe2`.

The production collector still uses text-only observations. The new positioned
path does not yet assign the two tablet candidates. The last full hard-day plan
remains 17/20 from the preceding implementation, with three unresolved photos.
Portable geometry runtime, source-bound positioned adjudication, full plan and
restart verification, other failing days and frozen annual replay remain open.
No production data, original photos, launchers or date defaults changed.
