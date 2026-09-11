# Coloured-paper code preprocessing audit

Diagnostic checkpoint, 2026-09-12. No production recognition behavior changed,
no assignment was authorized, and no annual, online or release gate passed here.
The complete-plan result remains 19/20 for the last verified March 4 replay.

## Reproduced problem

The remaining March 4 code line produces different 6/8 prefix readings from
the two original detector paddings. Changing only Sharp's resampling from
Lanczos3 to linear did not remove that disagreement. The averaged sequence
confidence can conceal a materially weaker individual character; neither a
model score nor a single higher-scoring view is a correctness probability.

The [upstream PaddleOCR inference implementation](https://github.com/PaddlePaddle/PaddleOCR/blob/main/tools/infer/predict_rec.py)
uses OpenCV resize in its standard recognition path. This motivated a bounded
resampling comparison, not a claim that Sharp linear is pixel-identical or
that a model-contract correction alone fixes the observed ambiguity. The
installed English ONNX model permits a dynamic input width, but width handling
was not changed or validated by this experiment.

## Fixed contrast comparison

Compare the unchanged original reader against extraction of the red channel
and normalization **before the same original tensor preprocessing**. This is
one model and one fixed alternative recipe, not another independent engine.
Read every original horizontal detector crop, including blank/non-code regions
and both paddings. Do not select only successful views, use filenames or PDF
expected numbers as input, or erase original contrary readings.

Before inference, freeze the crop list and source/model/implementation hashes.
For each original view, require a fresh baseline to reproduce its saved full
code observations, incomplete-tail flag and confidence (within 1e-6). Rehash
sources and baseline reports after the comparison. Only code strings, scores,
hashes and counts are retained by the private diagnostic reports; body text,
images and local paths do not enter this repository.

Model SHA-256:
`70b2450eed39599af6b996c27a2f1a0ef30eeb49f9f66dd3e74f28f652befc89`.
Unchanged recognition source fingerprint:
`9b496314758cde4094bc8491cd2c8bd8268e7572c08851ff230de3e1cb3d200f`.

## Observed results

| Scope | Photos | Original crops, each read both ways | Single code sets: original / contrast | Seconds |
| --- | ---: | ---: | ---: | ---: |
| March 4 diagnostic set | 20 | 1,294 | 15 / 16 | 73.258 |
| June 10 and September 6 comparison set | 40 | 2,464 | 30 / 33 | 141.163 |

All fresh baseline-parity and source-integrity assertions passed. For March 4,
only the residual prefix-conflict photo's code set changed. On the other two
dates, five photo code sets changed: one empty-to-single, two multi-to-single,
and two single-to-different-single prefix readings. The other 54 of the total
60 photo code sets did not change. These are 3,758 crop inputs and 7,516 actual
reader calls, not 7,516 independent photographs or successful orders.

**Single-code count is not accuracy.** These photos were previously encountered
in diagnostic work, not an unseen independent accuracy benchmark. Crops are
reused original detector locations, not a new full detector/body/assignment run.
The two prefix replacements and every newly stable reading still require
independent full-code/physical-PDF evidence. Existing contradictory original
readings remain preserved; this experiment grants no authority to clear them.

## Next gate

Investigate the changed cases with an independently read full code and current
physical-PDF content, including duplicate/foreign-prefix counterexamples.
Only after a source-bound adjudication rule has regression tests may a candidate
enter the full plan, JPEG, restart, representative-day and frozen annual gates.
Do not replace the production reader solely because this local score improves.
Manual CAPTCHA, fixed launcher and default business dates remain unchanged.

## Independent verification and rejected replacement

The six changed photos were subsequently checked against their actual physical
PDF pages, using both the visible print code and whole-page content. A pinned
independent English reader made 48 reads across 12 original crops and four fixed
recipes (2.341 seconds). This was a targeted diagnostic, not independent annual
accuracy measurement. Original source hashes were unchanged.

The empty-to-single case was **wrong**: contrast preprocessing produced suffix
188, but the photo's actual physical page has suffix 186 and a different body
from the real 188 page. The real 188 photo also demonstrates a different failure:
the independent engine repeatedly returned the wrong month prefix at scores
above the existing threshold. High confidence or a repeated single string is
not sufficient evidence that a code is correct. The proposed blanket contrast
replacement is rejected; it has not been installed in production.

The unchanged frozen full planner was then run on all 21 June 10 photos and
five PDFs / 18 physical pages. It completed in 390.909 seconds with 11 assignments
and 10 unresolved photos: six prefix conflicts, three suffix conflicts, and one
unconfirmed complete code. The body collector made 26 fresh reads and zero cache
hits (18 PDF pages and eight photo claims). All ten unresolved code cases were
excluded before positive body adjudication. All five manually page-verified
changed June cases remained unassigned, including the unsafe contrast case.
No original file changed, no online operation occurred, and the frozen source
fingerprint stayed identical. This is a completed diagnostic run, **not a passed
day or annual acceptance**; zero disagreements with old filenames is not proof
that all assignments are independently correct.

Regression assertions now cover a stable wrong suffix with two same-engine
views and with two agreeing engines: contrary paired physical-page body evidence
must still veto it, with raw observations unchanged. Positive controls with the
matching page body continue to resolve. These use synthetic fields, not customer
content, and test the adjudication boundary rather than reproducing real OCR
pixels. The ordinary suite passed 235 tests plus its imported assertion modules.

The next repair must address how unresolved raw-code ambiguity obtains additional
source-bound evidence, without treating every high model score as a physical
contradiction or clearing genuine opposite-page evidence. It must retain the
unsafe stable-reading case above as a negative test. Recognition code and the
software version are unchanged by this checkpoint; no release tag was created.
