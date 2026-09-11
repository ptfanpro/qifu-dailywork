# Semantic portable asset staging (development only)

## Scope

`tools/stage-semantic-assets.mjs MODEL_FILE HEAD_FILE ISOLATED_APP_ROOT`
copies an already available, pinned encoder/head into an isolated application
snapshot. It does not download a model, configure credentials, modify the
launcher, change dates/login, upload anything, or authorize a release.

The target must have the expected application package identity and no `.git`.
Use an exported Git snapshot, never the source/deployment directory. Runtime
default paths are:

- `models/scene-semantic-v1/vision_model_int8.onnx`
- `models/scene-semantic-v1/role-head.json`

The source byte hashes are fixed by `scene-semantic-reader.mjs` and
`scene-semantic-policy.mjs`; callers cannot override them on the command line.
Head structure is also validated. Both sources are verified before destination
creation. Files are copied from verified bytes to a unique staging directory,
verified again, and the directory is renamed into place. Exact existing
bundles are idempotent; differing/extra files are rejected, not overwritten.
Linked paths, duplicate/case-colliding names and path escape are rejected.
Cleanup only removes owned, hash-matching staging files, not unknown files.

The receipt contains only relative asset names, sizes, digests, application
version and `releaseAccepted: false`. Failure output does not print private
source paths. Model/head bytes remain ignored and outside Git.

## Tests and validation

- The new test initially failed because the staging module was absent.
- Four regression tests cover verified copying/idempotence, damaged input,
  duplicate names, path escape, unrelated applications, unexpected contents,
  no destructive replacement, and linked directories.
- The ordinary suite passed all 193 tests with no failures/skips.
- Complete Windows regression also passed: the same 193 tests, process/UI,
  synthetic long-path Windows OCR, actual local OCR/model-cache integrations,
  and local browser checks (exit 0). This is not customer-order acceptance.
- An isolated snapshot was exported from commit
  `2304c00eb1f3595dd95c4d151d7cc29e3eed9912`, without copying ignored development
  files. The real encoder (94,553,333 bytes) and head (161,622 bytes) staged
  successfully. A second invocation returned `created: false`.
- Actual source-photo/main-dispatch verification used only the application's
  **default relative asset paths**, not temporary source-asset overrides.
  Three manually reviewed whole-image counterexamples gave the correct
  paper/water/water roles and routing. One model load, zero unavailable reads,
  zero attempted network/subprocess calls, 66.756 seconds. Original bytes and
  frozen source fingerprint stayed unchanged.
- Archive recognition fingerprint:
  `8fa6b946bba7d02a0b7939cd16bc25c7d8c48ef1cb3cbbac1cd6a0161d477bdb`.
  Worktree CRLF and archive LF produce different byte fingerprints; the actual
  frozen snapshot was measured, not assumed identical to the worktree.

## Unfinished recognition issue (not hidden by packaging)

The paper counterexample still has a full-prefix conflict. The two original
Paddle reads agree; a low-confidence Tesseract red-channel read disagrees.
A fixed diagnostic matrix retained every result from two original detector
crops, three preprocessing recipes and three segmentation modes. None of
the eighteen Tesseract reads independently recovered the complete correct
code with both separators. A distinct Chinese Paddle model read the complete
code in both crops, but this is not a new independent OCR engine and is not
used to clear the conflict. The probe changed no business rules or results.

Thus the three correct roles are **not** three completed orders. Model staging
cannot bypass number, physical PDF/page, duplicate, scene or order-binding gates.

## Actual frozen full-planner comparison

One previously difficult date was replayed using the same exported snapshot
and default relative models: 20 original photos, four PDFs, 16 physical pages.
Inputs were copied with opaque photo names; historical filenames were used
only after recognition for comparison, never supplied as answers. The run
completed in 435.862 seconds, with original/source hashes unchanged, one
semantic model load, 20 semantic reads and zero unavailable reads. Network
was disabled. Only the pinned runtime-location helper was actually invoked;
the permitted local Windows OCR helper was not needed in this run.

Compared by exact photo SHA-256 with the preceding frozen full-planner run:

| Result | Previous | Current |
|---|---:|---:|
| Photos assigned a processing plan | 9 | 13 |
| Still unresolved | 11 | 7 |
| Blessing photo plans | 8 | 9 |
| Lamp scene plans | 1 (wrong category) | 2 |
| Water scene plans | 0 | 2 |

All eight previous numeric assignments remain unchanged. One further paper
and three previously unassigned scenes gained plans; one water scene formerly
misrouted as lamp is now water. The four actual scene originals were visually
reviewed for their subject, independently of their old filenames. The newly
assigned paper's printed code and visible body were also visually checked
against the actual rendered physical PDF page. These manual checks are
validation evidence only and were not fed into the planner or saved as overrides.

Seven papers still fail: two prefix conflicts, three number conflicts, and two
without independent full-code confirmation. All seven completed detector
coverage with zero reader errors. Six have a semantic paper observation and
one remains semantically uncertain; none was relabeled as a scene. This is
an unresolved recognition/decision-path problem, not a missing portable model.

The planner's `ready` remains false. `safeToApply: true` permits only its
independently confirmed subset; it does not certify this day as complete.
No application/upload/status changes were executed. One date's improved
result and its zero old-filename-reference disagreements are not full-year
accuracy, complete order-ID acceptance, or a reproducible speed guarantee.

## Remaining release requirements

This is not a tagged portable release or clean-machine acceptance. These runs
still use the installed Node/library runtime. Model redistribution notices,
complete dependency packaging, a clean-machine run, the final frozen full-year
replay, exact physical PDF/order verification and authorized online acceptance
remain required. The existing known-defect release gate has not been removed
or turned green by inserting expected roles or allowing abstentions.
