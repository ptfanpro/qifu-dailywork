# Small-print localization diagnostics — not an accepted replacement

2026-09-12. Read-only experiments on six retained residual photos: three with
no complete detected code, and three with prior code/body disagreement. No
PDF answer, missing-number set, historical name or capture order selects a
detector region. Source images and prior observations remain unchanged.
Actual photos, crops, raw text and detailed reports stay in private TEMP.

The checked-out source fingerprint for the six-photo OCR probes is
`a33144b45361a1824783bd1820592e5b6c2021c24da0769f91fc2af0e72957c6`.
This is not the frozen full-day package fingerprint and the probes do not
replace its acceptance. Experiments block network/child-process operations;
the separate local OpenCV geometry process only reads the six private inputs.

## Locate the failure before changing consensus

Two manually inspected tiny printed-code regions were used only to measure
the original DB detector probability map. Neither contained a probability
at or above 0.3: maxima were approximately 0.00000152 and 0.10649. Therefore
changing connected-component acceptance or the final OCR voting rule cannot
recover these two baseline regions. These manually selected coordinates are
diagnostic references, never recognition input or authorization evidence.

Complete-frame tiled detection (960×720 tiles, 240×180 overlap, scale 2,
default detector cap) followed by both engines and both original-pixel
paddings took 370.402 seconds for six photos. One previously blank photo
produced a complete-shaped code with an unresolved prefix; no photo obtained
a confirmed candidate. One control exceeded the eligible-region budget, so
its coverage explicitly remained incomplete. No truncation was called full
coverage. A further fixed 640×480 / scale 3 / 2048-cap localization diagnostic
on the two references took 64.758 seconds: one was still not detected and the
other's prefix disagreement remained. It is not a successful OCR replacement.

## Classical small-stroke proposals are insufficient too

A separate fixed, whole-frame red-channel adaptive threshold (31-pixel
window, constant 5), bounded small components and 9×3 horizontal closing
located a proposal overlapping both diagnostic references. No reference
coordinates were supplied to that algorithm. Candidate generation for all
six photos took 88.470 seconds; it is an unoptimized private diagnostic,
not production code or daily-workflow timing.

Both OCR engines then reread every eligible proposal with both paddings:
59, 83, 90, 76, 84 and 163 regions; all six reads had complete coverage and no
reader error. They took 86.453 seconds. Two blank-code cases stayed blank;
one gained only a foreign-prefix string. A prior code/body-disagreement
control produced a two-engine candidate, but its body conflict remained.
Agreement alone cannot authorize it. The alternative is **not adopted**.

Finally four manually referenced crops (two paddings of each of two images)
were inspected and read with the English, Chinese and server models plus
Tesseract. The underlying code crops were only 52–60 pixels wide and 15–19
pixels high including padding. Complete strings, separators and prefixes
still disagreed or were absent. This demonstrates a character-reading limit
in addition to the localization problem; merely finding a region is not a
complete repair. These manually selected readings cannot clear any conflict
or populate a production cache.

Engineering `timing.json` / `timing-audit.json` for the tiled and full
small-stroke OCR probes are closed and marked non-business-SLA. All original
hash checks pass. No release gate, assignment policy, detector threshold,
default date, login flow or launcher was changed by these experiments.
There is no claim of six newly fixed photos, annual accuracy or completion.
