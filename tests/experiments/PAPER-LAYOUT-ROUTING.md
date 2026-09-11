# Paper-only layout routing diagnostic — rejected

The paper head alone receives the 1024-dimensional visual/layout features;
the lamp/water head retains its original 512-dimensional visual features.
This tests whether text geometry was contaminating the scene category head.
It is not imported by production and grants no upload or numbering authority.

The same 153 reviewed training photos (72 dates), constants and two correlated
views were retained. The category head uses only the 95 unambiguous lamp/water
training labels. Development/hard evaluation identities are held out by date
and hash. Previously examined development data is not a blind acceptance set.

Results:

| Set | Same role | Unresolved | Wrong definite role |
| --- | ---: | ---: | ---: |
| 143 development photos | 142 | 1 | 0 |
| 41 definite hard labels | 22 | 19 | 0 |

Four additional mixed scenes remain provisional: three unresolved and one
unvalidated scene proposal. Do not count the latter as a correct prediction.
Hard-set coverage loses eight candidates relative to joint layout, while
gaining three. Separating the heads therefore does not solve the replacement
problem. No production assignments were made; do not repeat this recipe
unchanged or combine accepted candidates across models to inflate success.

The scene-head weights and all 188 evaluation scores are exactly unchanged
from the original two-stage head. Independent augmented Gram/intercept solves
agree within 6.89e-15. All 344 original input hashes remain unchanged. The
evaluation took 8.453 seconds using saved features, not a fresh annual OCR run.
An initial verifier failed because NumPy testing queried the platform through
a prohibited subprocess; pure array comparison avoided that unrelated query,
without relaxing the subprocess/network guard. The failure was retained.

Synthetic tests: routing 3/3, original two-stage 6/6, linear probe 7/7.
The complete Windows suite previously run on this same production tree passed
168 ordinary tests plus its runtime/UI/OCR/browser checks. The release gate
was rerun and still fails the three original production scene counterexamples.
No version bump, deployment or main merge. Private features, labels, weights,
source paths and timing evidence remain outside Git. Engineering wall time
includes interruptions; it is not daily-work performance acceptance.
