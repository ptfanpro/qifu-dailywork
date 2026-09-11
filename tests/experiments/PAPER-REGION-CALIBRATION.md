# Training-only patch calibration: improvement, not release acceptance

2026-09-11. Follow-up to `PAPER-REGION-REJECTED.md`; no production changes.

## Hypothesis and isolation

The first regional probe fixes ridge 0.1 while its per-class observation weights
sum to one. This was a design choice, not a measured optimal regularization.
Test whether excessive shrinkage is suppressing real paper scores, without
changing the 0.75 patch cutoff, 12-cell connected area or two-view requirement.

The new calibrator sees only the same 25 manually reviewed training images,
one per date, with conservative interior/background masks. It selects among
the predeclared grid 0.1, 0.01, 0.001, 0.0001 using whole-date-out squared cell
error, balanced first by photo within each class and then across classes.
Unknown boundary cells are excluded. Reserved dates and duplicate image hashes
are rejected. The selected weights and source hashes are saved before opening
the prior held-out labels. Training selection loss is not independent accuracy.

No new visual-model inference: hash-verified spatial features from the previous
369-image run are reused. Source and inputs are privately frozen. The complete
100-fold training selection, held-out evaluation and independent solve took
32.4145376 seconds; all 369 original hashes were rechecked unchanged.

## Actual outcomes

| Ridge | Balanced training selection loss |
| --- | ---: |
| 0.1 | 0.07408221 |
| 0.01 | 0.03183762 |
| 0.001 | 0.02474222 |
| 0.0001 (selected) | 0.02465275 |

| Held-out paper cohort | Total | Previous region proposals | Calibrated proposals |
| --- | ---: | ---: | ---: |
| Earlier development | 115 | 5 | 110 |
| Earlier hard | 27 | 0 | 15 |
| Earlier training, now held out | 50 | 5 | 34 |
| Original release-example paper | 1 | 1 | 1 |

All evaluated lamp, water and mixed cohorts still produce zero paper proposals.
This is not proof of their correct scene purpose, and mixed labels remain
provisional. These previously inspected cohorts are not a blind test set.
The result supports excessive shrinkage as one cause of the first regional
probe's poor recall, not as the explanation for every production defect.

Of the earlier whole-image probe's six definite hard abstentions, only one now
has a two-view paper region. Four paper examples still fail the region-size
criterion and the water example has no region. Do not report all six recovered;
even the one new paper proposal has not yet passed printed-code/page binding.
The chosen value is at the grid boundary; do not extend the search using these
held-out outcomes or promote the model on this result alone.

## Regression and integrity

- Supervision tests 6/6, calibration tests 3/3. New tests first failed before
  implementation, then passed. They cover whole-date exclusion, duplicate and
  reserved-date rejection, deterministic selection, class/photo balance, finite
  positive regularization and preservation of the previous default.
- Approved full Windows suite: 173 ordinary tests, zero skipped; actual
  OCR/model/cache, process/UI and browser integration checks passed, exit 0.
- Separate production release gate: all three existing unsafe heuristic
  decisions still fail, exit 1. No gate expectation was changed.
- Independent centered normal-equation solution agrees on scores within
  1.016e-13 maximum.
- Private selected-weight SHA-256:
  `72fc1fadd03a32621c767571759d2ce57196eaf80ab181d17d86cd494817a9be`.
- Private selection record SHA-256:
  `7ddb2010346b086b6476239dd598a0a4f9d0cb6b1a7ef5c740d150dd7ca9ea91`.

Next useful step is image-only region-guided OCR on the remaining paper cases,
with the original whole-frame code observations retained. A regional proposal
may locate extra reading windows, never manufacture a code, overrule contrary
full-code evidence or authorize an upload. The annual frozen replay and exact
physical-page/order binding remain incomplete. No release/version/launcher or
online business state has been changed.
