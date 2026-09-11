# Rejected SigLIP2 plus text-layout diagnostic

2026-09-11. No production source change, release or upload authorization.

The previous pinned SigLIP2 encoder's 768-dimensional unit vectors were
concatenated with the existing 512-dimensional spatial text descriptor and
renormalized. The two image views share the same layout vector and are not
independent evidence. No new OCR or visual-model inference was performed for
this join: it reused 344 independently hash-checked private feature records.

Training remains 153 manually reviewed images from 72 dates, four classes,
ridge 0.1 and margin 0.15. Development and hard sets were unchanged; their
previously examined labels do not constitute a blind generalization estimate.

| Evaluation | Same role | Unresolved | Wrong definite role |
| --- | ---: | ---: | ---: |
| 143 development images | 142 | 1 | 0 |
| 27 hard paper images | 25 | 2 | 0 |
| 4 hard lamp images | 3 | 1 | 0 |
| 10 hard water images | 10 | 0 | 0 |
| 50 date-out paper training images | 45 | 3 | 2 |
| 52 date-out lamp training images | 48 | 4 | 0 |
| 43 date-out water training images | 31 | 12 | 0 |

Four hard mixed scenes produce one abstention and three unvalidated proposals;
eight date-out mixed examples produce six abstentions and two unvalidated
proposals. These are not correct purpose classifications.

The definite hard set gains five but loses two relative to SigLIP2 alone.
Two paper examples become water in whole-date-out validation. Reject this
recipe: a higher aggregate count does not justify those regressions.

Independent reconstruction agrees within 1.67e-16 for joined features and
1.80e-14 for scores. Evaluation took 7.216 seconds; original images were
rehashed unchanged. Private manifest SHA-256:
`017eb86646f112f93fce64e483e2d6b41b678131b7732e7a36d686dc30fa3e02`.
Private weights SHA-256:
`8fb155a9d2c2041db61f54024945189f764fb7111131630c3269c0bfa5c3b639`.
Parent artifact hashes, not a null optional layout-file field in the private
join record, bind the input layout observations.

The experiment API now requires explicit `visualDimensions: 768`; its old
512 default is preserved. Dimension regression tests: 6/6. The complete
approved Windows suite passed 172 ordinary tests, no skips, and all actual
OCR/model/cache, UI/process and browser integration checks (exit 0).
No caller in
production imports the experiment module. Classification alone still cannot
verify printed codes, physical page identity or online order binding.

Next hypothesis: learn paper-region evidence from date-diverse original
images rather than continue adding whole-frame feature mixtures. Existing
paper supervision is only 50 images from 8 dates, including 45 from 3 dates;
the overall 72-date training count conceals this paper-specific concentration.
Do not use hard-set annotations as training data or claim that this data
imbalance is already proven to be the sole cause.
