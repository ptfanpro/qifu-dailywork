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
