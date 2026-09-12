# Skip geometry that the adjudication policy cannot consume

Candidate performance repair, not release or recognition-accuracy acceptance.

## Reproduced defect and repair

The production body collector selected every unresolved, non-conflicting code
candidate for expensive positioned-layout collection. The final adjudicator,
however, explicitly prohibits geometry from replacing the stronger body/date
proof required by prefix-only and printed-date-prefix repair routes. Such
candidates could therefore compute an all-page geometry result that was never
eligible for use. This did not justify relaxing their evidence requirements.

New actual-collector assertions for both routes first failed on unchanged
production code: `positioned-layout-unavailable` instead of `not-needed`.
The collector and adjudicator now share one eligibility predicate. Eligible
ordinary full-code ambiguities still reach positioned collection. Prefix/date
ambiguities remain unresolved without sufficient independent evidence; the
raw code history is unchanged and no resolution authorization is fabricated.

Five added collector cases cover shared body, one-field body, contrary body,
insufficient printed-date body and missing printed-date support. Existing
successful prefix/date cases and the ordinary-code missing-geometry case are
retained. Full Windows tests pass: 238 ordinary tests, zero failed or skipped,
plus UI/process, actual OCR, runtime/cache and four local-browser cases.
The actual pinned geometry join integration also passes 24 assertions,
one fresh join, 11 rejection cases and four process restarts (10.5 seconds).
It used unchanged worker/runtime assets from the previously verified package
with the current JavaScript tests and adjudicator. It is not a new frozen
package or a different-computer business acceptance.

No measured whole-day speedup is claimed yet. The separate June 13 full-day
replay uses its already-frozen earlier commit and is not relabelled as a run
of this repair. Launcher, date defaults, manual CAPTCHA and online write gates
are unchanged. No original photo/PDF or online order was modified.

## Rejected detector experiment

A separate private read-only experiment tested fixed normalized red-channel
detection with original-pixel OCR, complete region coverage and both engines
on six real cases (58.106 seconds). Three formerly blank detections remained
blank; a known wrong-code control acquired apparently stronger agreement on
the wrong number. Original hashes and raw observations were preserved; no
network or external process was attempted. This recipe is NOT adopted into
production. OCR agreement alone is not correspondence evidence, and raising
the apparent recognition rate must not bypass the current PDF/body veto.

Remaining residual cases, frozen available-year replay and release gates are
still open; this document does not claim that all recognition failures are fixed.
