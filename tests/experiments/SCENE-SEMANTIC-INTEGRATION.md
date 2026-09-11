# Semantic scene routing integration — development only

2026-09-11. Follows `SEMANTIC-READER-PORT.md`; does not replace its frozen
migration results or claim a release/full-year acceptance.

## Actual integration

`recognizePreparedImage` now attaches a source-bound semantic observation to
every new/numbered-photo reading. `planPhotoPreparation` owns one lazy shared
session and disposes it together with the OCR readers. Constructing the session
does not load a model or delay GUI startup. Failed asset loading is attempted
once per run, not once per photo. Missing/invalid model status is explicit; it
is not evidence that the customer's photograph is blurry.

Role scores never override a printed code, incomplete/failed code search,
conflicting observation or PDF/body rejection. A paper observation prevents
old global colour metrics from treating a sheet in front of bowls/candles as a
scene. Unknown/mixed/unavailable observations cannot fall back to brightness.

`classifyScenes` no longer scores global brightness to pick lamp/water. It
requires the same source-bound semantic observation, reruns the code vetoes,
and rehashes the original file before allocation. Category capacity is still
independent: full lamp slots cannot turn the next image into water and vice
versa. Pure legacy metric objects remain available for diagnostic controls;
they cannot authorize a live scene assignment.

All four semantic modules are now part of the recognition source fingerprint.
Observations retain exact source, pixel recipe, encoder/head hashes, both
view scores, and the existing verified OCR/runtime fingerprint when available.
There is no persistent semantic-result cache or reuse from an old plan.

## Portable assets are not yet a released package

Default relative paths are `models/scene-semantic-v1/vision_model_int8.onnx`
and `models/scene-semantic-v1/role-head.json`. The encoder and head must match
their pinned SHA-256 values in the reader/policy. The private exported head
and encoder remain outside Git. Offline verification supplied explicit local
asset paths to the same service; no download/network/Windows trust changes.

Tagged portable asset staging, clean-machine validation, and the final
full-planner/annual gate are still required. Do not deploy a source-only copy:
it intentionally cannot classify scenes without the verified asset bundle.

## Regression evidence

- Three new policy/assignment tests failed against the preceding implementation
  and passed after integration. Five tests now cover metric contradictions,
  code vetoes, stale/corrupt observations, source replacement, capacity, lazy
  loading, disposal, and repeated model-load failures.
- Existing real dispatcher tests additionally inject an incorrect scene role:
  independently read full codes still win. Missing semantic assets also do not
  erase a valid code. Existing category/capacity expectations are retained.
- Colour-block allocation fixtures now use explicitly synthetic semantic
  observations. They test allocation only, not model accuracy. The first
  ordinary-suite attempt failed on old fixtures without observations (exit 1);
  that was not counted as a pass. After the fixture update the suite passed.
- Complete Windows regression passed: 189 ordinary tests, no failures/skips,
  plus process/UI, synthetic Windows OCR long paths, actual local OCR/model
  caches, and local browser integrations (exit 0).
- Three manually reviewed whole-image counterexamples were actually read through
  the modified production photo dispatcher, real local semantic encoder/head,
  real Paddle/Tesseract detector/code reads and scene allocator. All three
  semantic roles and routing outcomes were correct: paper, water, water.
  One model load, no unavailable reads, no network/process calls attempted;
  source images and source fingerprint stayed unchanged during the run.
- First main-path run took 65.904 seconds. After adding the explicit unavailable
  model diagnostic, the final source was reread on all three originals again:
  62.561 seconds, the same three correct roles/routing outcomes, no external
  calls and no source changes. Final recognition fingerprint:
  `40fa072afa7bdc749e0fcb97d1a974a975669843d79cb7f37b424aeb44d219dc`.
  These are two runs of three unique photos, not six independent test samples.
- **The paper still has a detected-code prefix conflict.** Its correct semantic
  role only prevents misrouting; its number remains blocked. This is not three
  completed business orders, nor a complete PDF planner or online test.

The existing legacy global-metric counterexample command is unchanged and
still demonstrates its three unsafe decisions. Its release gate is not
silently made green with synthetic labels or abstention. Next gate work must
retain these cases and require actual, portable model/main-path evidence,
not just the obsolete metric helper. Full frozen-year replay, exact physical
PDF/order binding and online acceptance remain separate unfinished gates.

No release/version bump, main merge, launcher/default-date/login change,
original rename/overwrite, upload or online status change occurred.
