# Code and current-PDF body adjudication

2026-09-11. Development candidate, **not annual or production acceptance**.
Base commit: `c00c086`. Frozen recognition fingerprint tested:
`49cc8a37fed55ea0b27c7eec50b55c9976823eb007a787f2452eadd1e32beac1`.

## Defect and change

Previously a weak contrary full string was retained correctly, but permanently
blocked the photo before its positive current-PDF body evidence could be used.
The body collector considered only surviving numeric claims. More OCR trials
alone could not repair that missing transition.

The new path considers fresh unresolved detected-code claims as well. It
requires all of the following, without using filenames or missing slots:

- complete, source-bound original scans and any recorded bounded scale scan;
- one high-confidence full printed code in both original crops of one region
  (Paddle >= 0.85); these are explicitly ONE engine, not two independent ones;
- no different credible code, retaining the existing Paddle 0.65 / Tesseract
  30 corroboration floors as conservative contradictory-evidence vetoes;
- a unique physical page in the full current PDF index;
- at least two distinct complete fields, each at least four Han characters,
  unique across the current PDF corpus and identical in both same-layout photo
  views; field hashes are intersected, not just counts added together;
- no corroborated contrary body field/gram in any view, including a candidate
  that has a lower score than the proposed page;
- photo and PDF source hashes checked before and after the complete read.

The original unresolved audit is preserved unchanged. A process-local
authorization is sealed to it, the source bytes and the new page proof.
Changing the raw observations or merely deserializing a label cannot waive an
old conflict. Prior PDF/body holds, unknown histories and portable independent
holds do not enter this path. Existing confirmed claims keep their old route.
The final duplicate, source-isolation and file/hash upload gates remain active.
This establishes page correspondence, **not online order-set acceptance**.

## Actual verification

1. Replayed saved observations from 16 photos and 16 physical PDF pages.
   Four of seven unresolved photos acquired positive joined evidence. The
   remaining three stayed unresolved. This was not itself a full-plan run.
2. Ran the complete offline plan afresh on all 20 original-source copies and
   four PDFs (16 pages), opaque photo filenames, empty plan state. It took
   485 seconds while some regression checks ran concurrently; this is not a
   controlled performance comparison.
3. The complete plan increased from 13 to 17 assignments, unresolved from
   seven to three. All 13 previous assignments (nine papers, four scenes)
   remained identical by source SHA-256, target name and kind. Four new paper
   correspondences were checked against the actual photographed codes and
   rendered PDF pages. No manual labels were injected into recognition.
4. Three unresolved sources remain excluded. Renaming each to its reference
   numeric name still fails the file/hash upload gate. The valid PDF number
   domain has 16 entries; that is NOT the approved file set of 13 papers. An
   initial diagnostic incorrectly equated these counts; it was corrected only
   after inspecting the gate and testing the three bypass attempts.
5. Tested all 240 off-diagonal swaps of the saved photo-body observations:
   zero mismatched joins accepted. This tests contradictory bodies in this
   batch, not a universal error-rate guarantee.
6. Ordinary suite: 198 Node tests, zero failures/skips, plus the new join and
   collector regression assertions. Full Windows process/UI, long-path OCR,
   Chinese real-model, detected/body/model-cache and local-browser suite passed.
7. Original source hashes and frozen recognition fingerprint unchanged. No
   external calls in the full-plan harness, no production writes or uploads.

Synthetic regressions cover shared/identical bodies, split fields, one-view
evidence, mixed pages, credible foreign/tail codes, incomplete scans, stale
source bytes, missing confidence, mutated audits, serialized labels, prior
holds, incomplete PDF corpus and source changes during actual collection.
Private photos, text, PDFs, raw observations and timing files remain outside
the repository.

## Remaining work

The three remaining photos include a credible prefix contradiction and two
tablets whose readable names are shared with other pages. This policy does
not guess those identities. Other historical dates and the frozen full-year
replay still need validation. Cross-computer acceptance, release gates,
version tag and deployment are not complete. No formal version is released
by this commit, and the installed workflow skill is not changed.
