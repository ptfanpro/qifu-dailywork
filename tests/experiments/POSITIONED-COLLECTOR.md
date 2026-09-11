# Positioned body/layout collection in the real photo plan

This is a development integration, not a release or an assertion that the
remaining recognition failures are fixed. No new page-number assignment rule
is enabled by this change.

## Observed gap and change

The body reader, positioned-cache validator and portable geometry worker existed,
but `reviewCurrentPdfBodies` still requested plain-text observations. Its actual
PDF-render/photo path did not pass image/field evidence to the geometry worker.

The collector now requests `positioned-v1` for batches containing eligible
unresolved full-code candidates. Original pure-text-only batches keep their
existing cache profile. The four text views and the existing body-conflict veto
remain in use. Position metadata is not treated as independent OCR.

After body review and reader release, only candidates still lacking sufficient
whole-field evidence, without contrary body evidence, enter geometry collection.
Already-resolved long fields and credible opposite full codes do not trigger it.
All physical pages in the current PDF set are included, not merely the claimed
page. Large inputs are partitioned into 32-page/8-photo requests without dropping
pages from the corpus. Explicit total input and time budgets fail closed.

## Source and authority boundaries

- Snapshot source bytes and positioned fields before awaiting computation.
- Require complete validated four-view records and exact oriented dimensions.
- Keep original body dimensions separate from bounded geometry-image dimensions.
- Hash original/rendered bytes, positioned views and every request; require live,
  unchanged results from the pinned app-local worker.
- Reassemble exact ordered physical page sets for every photo; reject duplicates,
  partial batches, source/view/shape disagreement and malformed image inputs.
- Rehash the entire original photo/PDF set after reader release and geometry.
  Changes invalidate apparent legacy body successes too.
- Missing geometry/runtime preserves unresolved cases and independently supported
  legacy results. It is not interpreted as successful correspondence.
- Persist only counts/hashes and the non-binding observation summary in the plan.
  Raw positioned text and coordinates are process-local private evidence. A
  deserialized or modified summary cannot retrieve that evidence.
- Never set `mayAssignNumber`, `mayClearCodeConflict` or `bindingVerified` true.

## Regression evidence

The existing actual-collector test was made to require position requests and
failed before integration (0 adjudications instead of the prior independently
supported 1). After integration it passes, including original raw-audit retention,
source replacement, incomplete corpus and post-review page-index checks.

Three new ordinary tests cover source dimensions/identity, complete batch
partitioning, malformed position observations and rejection of serialized proof.
Existing collector regressions also cover source replacement during reader
release and missing geometry for a shared field. Test reader positions are
explicit synthetic fixtures, not OCR accuracy evidence.

Observed validation on 2026-09-12:

- 210 ordinary Node tests passed, 0 failed or skipped; complete Windows process,
  UI, OCR/model/cache and local browser checks completed. The restricted Windows
  suite skipped DPAPI as expected; a separately approved desktop-context run of
  the actual process-safety test passed both synthetic DPAPI round trips without
  skips. This is not a test of real saved credentials or another computer.
- The explicit runtime integration completed two real smoke computations, one
  synthetic geometry match, one actual positioned-collector call and six failure
  rejections. Evidence survives neither report mutation nor serialization; a
  returned copy cannot poison the retained observation. About 44.210 seconds.
- A complete isolated 2026-03-04 plan read 20 real images and four PDFs (16 pages).
  It took 555.116 seconds; all prior 17 assignments stayed identical, three
  remained unresolved, zero manual overrides and zero historical-name differences.
  No source files were changed and no network/online operation was requested.
- The real main pipeline performed 31 fresh body reads with zero cache hits:
  all 16 pages and 15 eligible paper photos. All 124 legacy text views matched
  the previous real observations exactly; every new position record validated.
- Only the two residual tablet photos entered the pinned geometry worker: one
  batch, 32 page comparisons, four geometry proposals, 81.899 seconds. This is
  observation availability, not two newly resolved photos or an order binding.
- Tested source fingerprint:
  `2157c58417286374c58fc61d54ac185e66fdaa42065dc1482477c7e0f4f411a5`.
  The isolated snapshot and source tree matched before/after validation.

The first test-snapshot assembly omitted `ocr-data`; the model integrity check
stopped immediately before reading photos. The missing pinned directory was
copied into that isolated snapshot before the successful new run. This was an
assembly mistake, not a model-recognition result or a failed production upload.
It was not counted as a successful replay. Test work partly overlapped; these
elapsed times are not a controlled speed comparison or daily-operation SLA.

## Still required

Positioned-field correspondence must be combined with original full-code evidence
and the complete current body/PDF corpus before it may supply a new assignment.
It must reject same-name/template-only matches, mixed pages, credible opposite
codes, stale source/index evidence and fake or modified observations. Then rerun
complete plans, real-source counterexamples and restart/receipt checks before
wider date replay. Frozen annual acceptance, another-PC acceptance and release
remain separate unmet gates.
