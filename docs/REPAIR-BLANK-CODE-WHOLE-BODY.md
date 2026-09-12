# Blank-code whole-field recognition repair

Status: development fix and targeted verification, **not annual or release acceptance**.

## Reproduced gap

The current-PDF body collector admitted reliable numeric claims and qualified
complete-code candidates. A photo with complete, successful but blank detector
and fixed-grid scans never reached the positive body path. Repeatedly invoking
two code readers could not solve this routing gap. The synthetic collector
regression first failed with zero adjudications where one was required.

The new route is separate from complete-code adjudication. It requires all of:

- Original, complete two-engine detector observations and complete fixed-grid
  observations, no complete code, no error/truncated scan and no existing claim
  or prior code/PDF/body review. A partial-glyph hint is retained, not presented
  as a complete-code observation or silently deleted.
- At least three distinct whole Han fields, each seen once in the same region
  in both padded views, with nonoverlapping original-photo crops. Fragments,
  repeated fields and fields pooled across views cannot supply this proof.
- Every field is unique in the **complete** current physical PDF corpus and
  supported by native extraction and paired visible PDF reads. Foreign content,
  duplicate bodies, incomplete page sets or duplicate numbers are rejected.
- Original source hashes, actual EXIF-oriented image dimensions, complete PDF
  hashes and number-to-physical-page index agree before authorization and again
  at recheck. No filename, remaining slot or assigned peer provides an answer.
- A process-local sealed authorization, bound to raw observations and proof.
  Serialized labels cannot establish new recognition authority. A valid exact
  JPEG preparation receipt can resume; missing receipt or changed source cannot.

The existing complete-code adjudicator still rejects a blank code. Its older
conflict/foreign-prefix/printed-date protection and regression expectations were
not relaxed. Body-only recognition cannot clear a previous failed audit.

## Integration failures retained

The first fresh production-collector run found the expected whole-field join,
but its subsequent claim recheck failed. The retained physical PDF index did
not serialize transient grayscale vectors; the legacy recheck filtered out all
pages without those vectors. A regression without grayscale vectors first
reproduced this failure. Only the new sealed whole-field route now uses the
complete physical index; other evidence routes retain their previous behavior.

An additional negative test demonstrated that body OCR could discover an
opposite full code that the earlier code readers had missed. The new route
now parses those positioned field readings too, retains contrary codes/tail
fragments as a persistent unresolved audit and refuses authorization. Matching
codes remain in the proof. It does not discard new contradictions after a high
body score. The initial failed test and actual failed-run timing were retained
in local private evidence; they were not relabelled as passes.

## Verification completed on 2026-09-12

- Whole-field screen: 2 positive cases and 22 rejection cases. The screen alone
  never grants assignment authority.
- Actual collector/recheck with generated image bytes and synthetic OCR fields:
  positive joins and 54 negative cases, including source races, old reviews,
  incomplete scans, serialized labels and new body-code contradictions.
- Actual JPEG transaction and separate child-process restart: exact receipt
  resumes; missing receipt, changed image/PDF and serialized recognition alone
  are rejected. Synthetic OCR does **not** demonstrate model accuracy.
- Final full Windows suite: 239 ordinary cases, zero failures/skips, plus actual
  Windows OCR, pinned Chinese/English model/cache, UI/process and four local
  browser checks. The new manual-assertion suites are additional to that count.
- Final real-photo verification uses the production collector and recheck:
  1 previously unresolved July photo, all 13 current PDF pages, 14 fresh body
  reads, zero cache hits, 86.859 seconds. The three-field join and subsequent
  physical-page recheck pass. Original raw code scans are retained from a
  independently verified immutable replay; they are **not new code OCR reads**.
  Originals, prior reports and raw code observations are unchanged; zero
  network/subprocess attempts. A fresh full-day replay is still required.

Checked-out recognition fingerprint for the final real-photo verification:
`0ddbcbd1204f746cc35fe0bc966569188fa9d9451a42ecd9d2f52476b3b6e2e8`.
Private photo/PDF/body text, paths and runtime reports remain outside Git.

The previous complete-package two-day result is still 32 assignments and
32 unresolved. Do not subtract the new targeted success until the new frozen
full-day replay and independent no-loss/no-remap comparison finish. Annual,
clean-PC and authorized online acceptance remain pending. No release tag,
deployment, default-date, fixed-launcher or CAPTCHA change is part of this fix.
