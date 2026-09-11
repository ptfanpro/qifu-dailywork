# Code/body source continuity and restart checks

Date: 2026-09-11. Base commit: `22a609f`. Development-only; not released.

## Reproduced defects and correction

The new code/body join had two missing defensive checks. These were reproduced
with synthetic inputs, not demonstrated production misuploads:

1. A photo replaced **after code reading but before body review** could pass the
   collector's before/after-body hash check, because both body hashes described
   the replacement. The collector now compares those bytes with the candidate's
   original code-read SHA-256 before permitting the join.
2. The next PDF recheck compared only the page ordinal. A changed PDF (or another
   PDF's same ordinal) could retain confirmation at that stage. It now reads the
   current photo and every indexed PDF and compares the complete physical
   PDF/page/number map with the sealed join's index hash.

Tests first failed on the unchanged code with `photo-changed-before-body`, then
with `post-body source/index substitution: pdf-bytes`. Both pass after the fix.
Existing final photo/PDF transaction gates were retained; this closes the earlier
evidence-stage gaps rather than claiming the old code necessarily wrote bad data.

## Regression evidence

- Added pre-body replacement and seven post-body cases: changed PDF bytes,
  changed photo bytes, another PDF with the same page ordinal, changed ordinal,
  changed other page's number, removed other page, and a deserialized method label.
- Real JPEG transformation from generated pixels and a separate Node process:
  a valid persisted plan/receipt can resume; missing receipt, replaced output and
  replaced PDF cannot reuse approval. A serialized label cannot create fresh
  in-memory recognition authority.
- All 198 ordinary Node tests pass, plus the top-level assertion modules. The
  new restart integration is imported by the standard suite.
- Complete Windows `ui/Run-Tests.ps1` passes, including process/UI/runtime path,
  long-path Windows OCR, actual Chinese model smoke, detected observation cache,
  pinned English-model cache, and four local browser regression cases.

## Actual one-day replay and isolated transaction

Recognition-source SHA-256:
`ffdbcd56015ae977fbc6ae0b2029b9ee9e140f5c7e9334b765e212d64a724656`

Fresh 2026-03-04 plan: 20 source photos, four PDFs, 16 physical pages. The same
17 assignments as the preceding revision were preserved exactly by source
SHA-256, target and category. These comprise 13 paper photos, two lamp scenes
and two water scenes. All four joined paper results still pass and their raw
code-audit histories are unchanged. Three unresolved sources remain excluded.
Giving any of the three an expected numeric filename still fails the upload
file/hash gate. `ready=false`, `safeToApply=true` for the verified subset.

The plan was additionally applied to a SECOND isolated copy: 17 actual JPEG
transactions succeeded and the three excluded files remained byte-identical.
New processes accepted the complete resulting receipt twice (before and after
restoration), and rejected isolated output/PDF replacements in two negative
checks. The replay inputs and business originals remained unchanged.

Full planning took 468 seconds (wrapper 468.987 seconds), with other local
regressions running during part of the interval. This is not a controlled
performance comparison or a measured live-business SLA. No network operation
or unapproved subprocess was invoked by the replay harness.

## Limits / next work

This correction improves source continuity, not this batch's recognition count.
The remaining strong prefix conflict and two shared-name tablet cases are not
resolved here. No online order-set verification/upload, cross-computer trial,
frozen annual acceptance, release-gate acceptance, tag or deployment occurred.
Private OCR text, source images, PDFs, plans and transformation receipts remain
outside Git in machine-local temporary storage. No rule/skill writeback is
justified by these offline engineering tests.
