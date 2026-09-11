# Rejected first paper-region probe

2026-09-11. Engineering diagnostic only. No production classifier, OCR,
photo assignment, online action, version bump or release.

## Frozen experiment

All 25 newly selected original images were visually reviewed. Their 25 dates
are disjoint from the earlier training, development, hard and release-example
dates: 18 paper photos, six lamp scenes and one mixed scene containing a small
paper. This is a small, unbalanced training set, not comprehensive ground truth.
The manually marked inner rectangles are certainly-paper interiors; the outer
rectangles exclude uncertain boundaries from background supervision. Neither
rectangle is a full paper segmentation. Annotations are used only in training.

The pinned SigLIP2 encoder actually processed 369 images (25 new inputs and
344 prior frozen inputs), exposing two correlated 14 x 14 x 768 patch grids.
Training uses unit patch features, photo-balanced/class-balanced binary ridge
regression (0.1), unpenalized intercept, score threshold 0.75 and a four-connected
component of at least 12 cells in **both** views. These settings were fixed
before the outcomes below; they have not been tuned on these held-out results.
Prediction receives no expected code, filename, PDF answer or manual rectangle.

## Results: reject for inadequate coverage

| Held-out paper cohort | Paper photos | Region proposed | No proposal |
| --- | ---: | ---: | ---: |
| Each new date excluded from training | 18 | 2 | 16 |
| Earlier development cohort | 115 | 5 | 110 |
| Earlier hard cohort | 27 | 0 | 27 |
| Earlier training cohort, now entirely held out | 50 | 5 | 45 |
| Release-example paper | 1 | 1 | 0 |

No paper proposal was produced for the non-paper cohorts in this experiment.
This is **not** correct lamp/water classification and does not establish useful
recall. The private report retains the old cohort name `crossvalidated` for
the previous 153 training images; those images are held out against the new
25-image regional training set, not crossvalidated training for this model.

New-date-out patch counts: 428 positive cells, 195 recovered; 7,145 negative
cells, two false positives; 2,227 boundary cells excluded. Do not turn the large
background count into a misleading overall accuracy score.

Inspection separates two failure modes. Some photos have detected interiors
but fail the fixed area/two-view requirement (two examples recover every marked
interior cell yet yield no proposal). Two other paper photos recover zero
marked positive cells, including a large close-up. Thus reducing the component
size alone cannot establish a fix. Do not relax the release gate to accommodate
this recipe. A later proposal must use training-only calibration and independent
evaluation, and must still preserve code/physical-page/order binding checks.

## Integrity and verification

- New input preprocessing: 5.552036 seconds.
- Actual 369-image model inference: 267.8186683 seconds.
- Training, whole-date-out evaluation and independent check: 20.0241174 seconds.
- Independent centered normal-equation solution score error: 9.33e-15 maximum.
- All 369 original photo hashes unchanged after evaluation.
- Private feature manifest SHA-256:
  `8101e27ca83ce3c6d32cbf935753815fb60c49b73dd2400b2b5adeb35b594ead`.
- Private weights SHA-256:
  `091d090d3056b3155936c31fc7a4464eba48849f6f9a91330e330bb5d1725976`.
- Python probe tests: 5/5. Node serialization test: 1/1, included in the full
  approved Windows suite of 173 ordinary tests, zero skipped, followed by
  passing actual OCR/model/cache, UI/process and browser integration checks.
- The separate production release gate still fails three known scene semantic
  examples. No production source was changed by this experiment.

Photos, annotations, raw features, trained weights, runtime paths and private
per-image reports are intentionally outside Git. The private manifest freezes
source and data hashes; engineering timing includes manual review and report
work and must not be interpreted as daily business execution performance.
