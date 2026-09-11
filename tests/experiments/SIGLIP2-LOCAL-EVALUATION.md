# Pinned local SigLIP2 image encoder — diagnostic, not production acceptance

This is a different public image encoder, not another vote from the existing
CLIP model. Inference runs locally with network and child-process calls blocked.
It does not recognize printed codes or grant numbering/upload authority.

Publisher: `onnx-community/siglip2-base-patch16-224-ONNX`, revision
`ba1f3b0843f24bc5417d38e19c37b287d719b2f4`, `onnx/vision_model_int8.onnx`.
Downloaded size: 94,553,333 bytes. SHA-256:
`0dd31785a2713f1113ef2272472165c69d580473dae38d7b47568ac587795e70`.
Only this pinned artifact is accepted. No remote Python code is executed.

## Fixed protocol

- Publisher preprocessing: RGB, Pillow bilinear resize to 224 square,
  rescale by 1/255 and mean/std 0.5. EXIF orientation is honored and alpha is
  explicitly composited over white. The canonical full frame is resized, not
  letterboxed. A second fixed center-square view is explicitly experimental;
  both views use the same model and are not independent evidence.
- `pooler_output` provides 768-dimensional vectors, normalized before fitting.
  No text prompt, customer field, expected code or filename selects a crop.
- Same 153 reviewed training images from 72 dates, unchanged ridge 0.1 and
  margin 0.15. Same four-role linear probe; no threshold selection on results.
- 143 development images and 45 hard/control images are date/hash-held out.
  These labels have been examined in previous studies: this is not a blind
  generalization estimate. Mixed-scene purpose labels remain provisional.
- Three original release counterexamples are also compared; the one sharing
  a training date uses a refit excluding that entire date.

## Actual result (2026-09-11)

344 source photos, two views each, were read and encoded. Preprocessing took
47.139 seconds; CPU encoding 255.518 seconds; evaluation 5.813 seconds.

| Evaluation set | Same role | Unresolved | Wrong definite role |
| --- | ---: | ---: | ---: |
| 143 development photos | 143 | 0 | 0 |
| 27 hard paper photos | 22 | 5 | 0 |
| 4 hard lamp photos | 4 | 0 | 0 |
| 10 hard water photos | 9 | 1 | 0 |

Four further mixed scenes: one unresolved and three unvalidated scene
proposals, not three correct classifications. The three original cases now
give paper/water/water in this diagnostic only; production still fails them.
Whole-date-out cross-validation of the 153 training examples is less favorable:
paper 45/50, lamp 48/52, water 30/43; the other 8 mixed labels are separately
provisional. Do not report 143/143 as universal accuracy or release readiness.

All 344 original hashes are unchanged. Independent preprocessing of all 688
views using float64 normalization differs by at most 5.94e-8. An independent
weighted Gram/intercept solve agrees on all 188 evaluation scores within
2.29e-14. Private features/labels/weights/input paths are not stored in Git.

The six definite hard abstentions are five paper photos and one water photo.
Four of those paper examples agree on paper in both views, but the full-frame
margin is below the fixed bound. One paper view instead favors lamp, and the
water full frame favors the provisional mixed class. Do not lower the bound,
drop the disagreeing view or count manual labels as automatic recovery.

## Verification and remaining work

Preprocessing synthetic tests 3/3; encoder contracts 3/3 are included in the
full Windows suite. The complete approved Windows script passed 171 ordinary
tests, no skips, plus actual OCR/model/cache, process/UI and browser checks.
The unchanged production release gate still fails its three known semantic
cases. No `src` change, version bump, main merge, deployment or online write.

Next: inspect the six unresolved input cases, validate foreground-specific
evidence, and expand this fixed encoder to further dates before integration.
Printed-code conflicts, physical page/order binding, frozen full-history
replay and authorized online acceptance remain separate, unfinished gates.
The acquisition/TLS diagnosis and one completed diagnostic do not mean the
annual task is running continuously. Engineering wall time is not daily SLA.
