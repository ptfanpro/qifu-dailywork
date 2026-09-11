# Cross-view prefix ambiguity: evidence and limits

Candidate branch: `codex/cross-view-prefix-body-20260912`.
Production fingerprint: `a25745c573b84198dc642d1c32ab1f3dcdccda7f616066cff15ec6b623df3f92`.
Version remains 9.6.8-rc.2. This is not a release or annual acceptance.

## Observed failure

Two completed diagnostic days exposed the limits of the earlier repair:

| Day | Fingerprint | Photos | Assigned | Unresolved | Unresolved without body review |
| --- | --- | ---: | ---: | ---: | ---: |
| June 13 | ee54b02dc9c0 | 48 | 16 | 32 | 27 |
| July 1 | ccd8046cd325 | 16 | 10 | 6 | 5 |

These are different frozen versions, not one latest-version accuracy total.
Both runs verified the original and copied inputs. June's comparison against
an older completed replay gained six assignments but lost seven; old assigned
filenames are references, not verified ground truth.

The detector's unresolved result bypasses the old narrow-grid path. A separate
read-only check of seven lost June assignments and six July residuals recovered
three complete codes, but the other ten remained empty or conflicting. Restoring
that old path alone is not a sufficient fix. A Windows check of 96 original-code
crops across 24 photos produced no complete code and was not promoted.

Fresh body observation then covered all 38 residual photos, reusing 64 valid
source-bound observations and performing 32 new body reads. This diagnostic used
the entire 58-page corpus, not the remaining/missing PDF slots. A unique body
candidate by itself did not authorize an assignment.

## Narrow repair promoted here

Three residual photos had the same asymmetric pattern: two strong V4 readings
of the expected full word; V5 read that word on one original crop and the
already-observed alternate prefix on the other. Previously the second V5 crop
prevented any body adjudication, even when physical PDF content was sufficient.

The new branch permits **body review only** when:

- the original high-confidence suffix is stable across both physical crops;
- prior-model readings are both at least 0.85 and agree on the complete word;
- both server readings are at least 0.85; one agrees and the other is exactly
  the original prefix alternative, with no changed suffix or third prefix;
- existing source seals, whole-word syntax, crop identities and independent
  opposite-consensus veto all pass;
- final adjudication finds two distinct, paired, page-specific whole PDF fields
  in the complete current corpus, with no contradictory body evidence.

There is no model majority vote, suffix repair, filename answer or missing-slot
completion. Raw contradictory words are retained. Geometry-only and short-field
fallbacks remain prohibited for this prefix path. The previous stricter
two-server-view path remains unchanged.

## Verification so far

- The new positive regression failed before implementation. Both crop orders
  now pass, as do 24 rejection cases and authority revocation after mutation.
- The previous prefix suite is unchanged and passes.
- Ordinary suite: 235 tests, zero failures/skips, plus imported new assertions.
- Actual targeted check: three positives across two dates; 12 freshly executed
  code reads, explicitly reused raw-code/body observations; 67 swapped-photo
  bodies and 100 duplicate-page bodies rejected. 79.065 seconds. Originals and
  raw audits unchanged; network/process attempts zero.
- Relevant complete physical PDF pages were rendered with Poppler and visually
  compared with all three source photos. These checks were validation, never
  answers supplied to the automatic planner.
- Windows full suite completed successfully from the repository working
  directory: UI/state, OCR long paths, pinned actual models, observation/cache
  provenance and four local-browser query cases. The two sandbox DPAPI skips
  were separately exercised with synthetic data in the approved desktop user
  context and passed without skips.
- Frozen portable positioned integration: 24 assertions, one fresh joint
  assignment, eleven rejection cases and four restarts passed (61.856 seconds).
  This is integration coverage, not a claim of actual-photo accuracy.
- Two earlier Windows-suite invocations failed on working-directory assumptions:
  running from the workspace failed the app-local model asset check; running
  from the temporary frozen app violated the audit-output test's non-TEMP cwd
  assumption. Neither failure was counted as passing or suppressed. The full
  unmodified suite was rerun from the authoritative repository and passed.

- July 1 complete-day rerun at the candidate fingerprint finished: 16 photos,
  13 physical PDF pages, 11 assigned / 5 unresolved, 788.926 seconds; 22 fresh
  body reads, zero body-cache hits. Both old and new report/source/copy/plan
  bindings were independently rechecked. Against ccd8046cd325: one added,
  zero lost or changed assignments, all 16 raw detector audits unchanged.
  The new assignment is the independently inspected physical-page match from
  the targeted check. `ready` remains false. Old filename/reference agreement
  is not independent ground-truth accuracy or online business acceptance.

- June 13 complete-day rerun at the same candidate fingerprint finished:
  48 photos, 45 physical PDF pages, 18 assigned / 30 unresolved, 1883.826 seconds;
  65 fresh body reads and zero body-cache hits. Against ee54b02dc9c0: two added,
  zero lost or changed assignments; all 48 raw detector audits unchanged.
  Both report/source/copy/plan bindings were independently rechecked.
  `ready` remains false. This is not full-day or annual business acceptance.

The broader unobserved-code and
body-review eligibility gaps remain open; this repair does not solve every
residual photo. No production uploads, date-default changes, login changes,
launcher changes, deployment, release tag or main-branch merge occurred.
