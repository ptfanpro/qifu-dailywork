# Mandatory real semantic-package check

The June 13 frozen replay completed with 17 assignments rather than the prior
19: one newly corroborated blessing photo, three lost scene assignments, zero
remaps and zero changes in the original detected-code observations. Its 69
body reads were fresh, with no body cache. The regression comparison FAILED;
the result must not be relabelled as successful acceptance.

All three losses were scene photos. Their semantic observations changed from
valid lamp/water scores to `semantic-reader-unavailable`. The new test archive
contained neither the pinned semantic encoder nor its role head. This is an
isolated-package assembly failure, not evidence that mixed-field adjudication
misread those three photos. No deployed package or online order was changed.

The previous release checks tested scene decision counterexamples but omitted
actual model loading from the final app-local package. The new regression
first demonstrated that a missing semantic-package stage incorrectly allowed
all release checks to pass. It now fails before layout/Windows stages.

`semantic-package-smoke.mjs` invokes the real production service with generated
pixels, verifies two finite paired observations with exact source/model/head
digests, checks one lazy session for two reads, and releases it. An unavailable
model is failure, not an unknown image classification. No downloads, training,
classification-threshold changes or fallback to legacy scene heuristics occur.

The new smoke check rejects the actual incomplete test archive (exit 1) and
accepts the previously verified complete app-local package (exit 0). Synthetic
pixels only demonstrate model/runtime availability; they are not photo
accuracy or annual acceptance. The release command now requires five stages:
scene counterexamples, actual semantic package, pinned layout runtime,
positioned join/restart, and the full Windows suite.

After the gate repair, the complete Windows suite passed: 239 ordinary cases,
zero failed/skipped, plus UI/process, actual OCR, runtime/cache and four
local-browser checks. This is a code result, not full-day acceptance.

The failed full-day archive is retained unchanged. A new Git snapshot must
explicitly stage both semantic assets using their fixed digests and the pinned
layout runtime, pass all five gates, and repeat the affected observations and
full-day comparison. Missing/pending annual, clean-PC and online evidence
still blocks a release, even when code tests pass. Fixed launcher, manual
CAPTCHA and photo-yesterday/PDF-today defaults remain unchanged.

## Complete package verification

Fresh Git snapshot `2698e4d` stages both assets through the fixed-hash staging
functions. Recognition fingerprint:
`f24dee9bf036e68e46c44b709948e45c87bb5a57a6fcf386e91826c1f5320bf7`.
Archive SHA-256:
`2c90e72a692e5b94fd71842ca142a001a0915e81bdbc5a5d778d7c743eb56bba`.
All five code-gate stages pass in 123.821 seconds. The frozen source is unchanged.

The three lost scene originals were independently reread using that package's
actual production semantic service: three fresh reads, one session, 4.329
seconds, recovering the same one water / two lamp roles and scene-entry checks.
Raw code observations and original hashes remain unchanged; no external
operation was attempted. This is targeted model verification, not full-day
acceptance.

The complete June 13 replay has now finished: 48 photos / 45 PDF pages,
20 assignments / 28 unresolved, 1801.298 seconds, 69 fresh body reads and
zero body-cache hits. Independent comparison against the prior complete
19-assignment package verifies one addition, zero lost assignments, zero
remaps and zero changes to original detected-code observations. Source,
originals, input inventory and complete audit-cache bindings are verified.
The three prior scene roles are retained in this full-day result, not merely
in the targeted smoke check. The former incomplete archive remains unchanged
and failed. `ready=false`: remaining unresolved photos and broader acceptance
still prohibit calling this a finished daily workflow or release.
