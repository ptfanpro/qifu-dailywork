# Local semantic reader migration — not yet used by the business planner

2026-09-11. Follows `SIGLIP2-LOCAL-EVALUATION.md`.

## Implementation boundary

`src/scene-semantic-reader.mjs` owns one CPU-only encoder session. It verifies
the pinned encoder bytes before loading those same bytes, and requires an
explicit SHA-256 for a complete finite four-role linear head. The head is
immutable, the two views and 0.15 margin are fixed, and mixed/disagreeing or
insufficient-margin observations remain unresolved. Scores are not
probabilities, and two views are not two independent engines.

The input is image bytes, not a filename, date, PDF answer or expected role.
The reader copies the source before asynchronous decode and binds observations
to its hash, oriented dimensions, pixel recipe and model/head identities. It
returns no numbering or upload authority. No model download, shell, Windows OCR
or network API is part of the reader. Private classifier weights and inputs
remain outside Git. Asset packaging and planner integration are unfinished.

`src/scene-semantic-pixels.mjs` makes resize, RGB, EXIF, alpha and float32
normalization explicit. The center-square and full-frame views match the
previous protocol. Triangle coefficients use fixed positive 22-bit weights
and byte rounding; generated up/downsampling references come independently
from Pillow. The active RGB recipe ignores embedded ICC transformations,
because training used Pillow `convert('RGB')`, not `ImageCms.profileToProfile`.
It does not mean ICC should be ignored when preparing images for display.

## Real migration regression caught before integration

The first implementation let Sharp apply its default embedded ICC transform.
Reading and encoding all 344 originals took 363.091 seconds. The linear score
port agreed with the original implementation within 2.56e-15 on the 188 old
date-held-out comparisons, but input pixels differed. That changed four
decisions: three extra correct proposals and one previously accepted paper
became unresolved. All three known semantic counterexamples were correctly
classified by the new reader. These gains did not excuse the regression; this
recipe was rejected without connecting it to the business planner.

A synthetic tagged/untagged RGB test reproduced the ICC mismatch, failed
before `ignoreIcc: true`, and passed after the fix. A failed assertion originally
attempted to format two very large pixel arrays; that owned test session was
interrupted and the assertion changed to compare their hashes. This changes
diagnostic output only, not the expected equality. The prior experiment's head
was exported without retraining or adjusting any threshold.

## Verification status

- Six regression tests cover model/head corruption, schema and finite values,
  score math, two-view disagreement, mixed roles, pixel geometry, independent
  resize references, alpha, EXIF, source mutation and ICC consistency.
- Full Windows suite after the ICC fix: 184 ordinary tests, zero failures or
  skips, plus actual process/UI, synthetic Windows OCR, OCR/model/cache and
  local browser integrations passed (exit 0).
- The complete corrected comparison finished: all 344 original images were
  decoded and encoded again in 340.908 seconds. All 103,563,264 preprocessed
  float32 values were exactly equal to the frozen training-recipe values.
  On the 188 old held-out comparisons there were zero decision changes,
  losses or gains, and zero wrong definite-role proposals. Existing abstentions
  remain abstentions; this is not a claim that every image was recognized.
- The three original cases again returned paper/water/water. Their full source
  images were also visually rechecked; file names were not classification
  inputs. Original and reader-source hashes were verified unchanged.
- The private head is an exact export of the previous weights, not retraining.
  Its SHA-256 is
  `363faa187eacfc3535a7b409f7d8b68dd97a7a1e8e1a0e392ba6c18c3d2baa36`.

Before business integration, asset packaging, source/runtime provenance,
code-conflict precedence, incomplete-reader handling, scene capacity and the
actual end-to-end planner must be verified. The current module is not yet
imported by `photo-prepare.mjs`; these checks must not be claimed complete.

The 344 include training and previously inspected development examples. This
is a compatibility replay, not a blind estimate of future accuracy. Production
scene heuristics, their three failing release counterexamples, PDF/order
binding gates, launcher/date/login defaults and version number are unchanged.
No claim of full-year, business closure, deployment or release acceptance.
