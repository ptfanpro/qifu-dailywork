# Mixed whole-field code/body corroboration

Candidate repair, not a release, annual acceptance or online completion.

## Reproduced defect

The alternate body corroboration routes accepted two unique long fields or
three independently corroborated three-character fields, but omitted the
combination of one long field and two short fields. Lengthening one of three
valid complete fields therefore made otherwise identical evidence fail.
The new positive regression failed on the unchanged production code first.

The mixed route retains three distinct whole fields, current-corpus uniqueness,
independent PDF extraction AND paired visible-PDF support for every field, two
same-layout photo readings, matching detector regions, exactly one occurrence
per field per view, and pairwise disjoint actual photo crops. It is considered
only after the existing long and short routes fail. It does not relax the
qualified full-code requirement, foreign-body/code veto, source integrity,
prefix-only or printed-date-prefix rules. Raw contradictory observations remain
unchanged. Only hashes/counts are retained in the proof.

## Regression quality repair

Adding an end-of-suite authorization test exposed shared mutable fixture arrays:
removing a PDF field in one negative case also removed it from subsequent cases.
Some later negative cases could therefore pass because of an earlier mutation,
not because their intended guard was tested. The first Windows run stopped on
the new assertion; it is NOT counted as a passing run.

Both the existing short-field fixtures and the new mixed fixtures now copy
their field arrays, keep the reference arrays frozen, and assert that each
fresh positive baseline resolves BEFORE applying its negative mutation. All
fifteen original rejection assertions remain; none were removed or weakened.

The corrected tests pass two mixed positive examples, 21 mixed rejection
examples, the original short-field cases, current-process authorization,
serialization rejection and proof-mutation revocation. Printed-date-prefix
tests retain their stricter rule with an additional mixed-field exclusion
(33 rejection cases in that module). Complete Windows regression passes:
238 ordinary cases, zero failed/skipped, plus UI/process, DPAPI, actual OCR,
runtime/cache and four local-browser cases.

## Actual fresh observation

A private read-only June 13 test loaded all four current PDFs / 45 physical
pages and the unresolved photo again, using the actual production body
collector. There were 46 fresh body reads, zero body-cache hits and two fresh
original-code crop reads. The formerly unresolved observed number 255 obtains
the mixed-field correspondence. Original photo/PDF hashes, source fingerprint
and raw code audit are unchanged. No network/process escape attempt occurred,
no NAS file was modified, and no online operation was performed.

Duration: 265.288 seconds. Working-source recognition fingerprint:
`4138f774da37f8877b1b8cada8f78806067e5a65037412f16e8a505ff3a3e762`.
This is a targeted fresh code/body check, not a full-day replay. The archived
Git snapshot may have a different fingerprint due to normalized line endings;
it must be measured and tested independently, never relabel this result.

The last complete two-day replays still recorded 33 unresolved photos. This
test resolves one of those in isolation; the complete day, remaining cases,
frozen available-year corpus, clean-PC and online acceptance remain pending.
The launcher, manual CAPTCHA and photo-yesterday/PDF-today defaults are unchanged.

## Additional rejection and frozen-package checks

The retained real observations also rejected 31 foreign-photo-body substitutions
and 44 duplicated PDF-body corpora. This diagnostic made four fresh code-crop
reads, reused body observations, and did not upload or assign files. A
prefix/date case and two insufficient/conflicting cases remain unresolved.

The isolated archive of commit `ff7022f` passes all four code-gate stages:
scene semantics, moved/pinned layout runtime, positioned join/restart, and the
full Windows suite. Duration: 164.4 seconds. The snapshot remains unchanged.

- Frozen recognition fingerprint:
  `e39ad788b9fd76f43f6e416f0f7e5b5837ddf591aec9010cab80f6e696339722`.
- Archive SHA-256:
  `4166ac0fe29f5e1d162bc83baf40e0be50cf873c3ad4dd2a39cf51710abeb9af`.
- The complete June 13 replay subsequently finished in 1658.319 seconds:
  17 assigned / 31 unresolved, versus 19 assigned previously. It adds the
  targeted photo but loses three prior scene assignments; no remaps or raw
  detected-code changes. Its regression comparison FAILED. All 69 body reads
  were fresh. The three losses were traced to omitted app-local semantic assets
  in this isolated archive, not accepted as harmless. The archive and failed
  report remain unchanged; see `SEMANTIC-PACKAGE-GATE.md` for the gate repair.

The branch was pushed after two transient empty-server-response failures.
There is no main-branch merge, release tag, deployment or annual acceptance.
