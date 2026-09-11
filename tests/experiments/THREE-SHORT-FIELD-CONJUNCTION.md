# Three disjoint whole short fields corroborating an observed code

Candidate repair, not an annual/online acceptance or release.

## Defect and bounded change

The existing non-geometric body join only accepted two individually page-unique
whole fields of four or more Han characters. A dense paper with several complete
three-character fields therefore stayed unresolved even when both photo views,
physical PDF extraction and paired PDF image readings agreed on those fields.
This was a missing corroboration route, not a reason to lower digit confidence,
ignore contrary evidence, or fill a missing number from filenames.

The new alternate route requires all existing full-code/current-corpus/source
checks and all of the following:

- At least three distinct complete three-Han-character fields, each unique over
  the entire current PDF corpus. Occurrences inside longer fields count against
  uniqueness as before.
- Each field exists independently in PDF text extraction AND a paired visible
  PDF reading. Individual PDF glyphs cannot be concatenated into a field.
- Each field appears exactly once in each of the two same-layout photo views,
  at the same validated detector region. Multiline joins and pooled fragments
  are forbidden.
- The actual padded photo crops are pairwise disjoint in both views. Repeated
  detections or several text strings from one region do not supply three fields.
- The existing full-body conflicting/ambiguous evidence veto applies first.
  The original code audit is retained, the original two-long-field rule and
  geometric rule are unchanged, and source/index integrity is checked again.

Only hashes, counts and the policy identifier are persisted. No names, original
photos, PDFs, runtime credentials or local source paths are part of this change.
This establishes local page correspondence, not online order identity/completion.

## Verification

The new synthetic positive failed against the unchanged implementation, then
passed after the repair. Fifteen rejection cases cover too few fields, repeated
text, missing positions, multiline assembly, disagreeing crops, altered crop
metadata, shared detector areas, overlapping crops, missing PDF extraction,
missing paired PDF image evidence, hidden longer-field occurrences, duplicate
bodies, wrong code/page target, credible independent code conflict and failed
views. Existing tests remain in place.

Ordinary suite: 235 tests, zero failures/skips, plus imported assertion modules
including the new positive and fifteen rejection checks. The Windows suite
passed UI/process, actual OCR/model/cache and local-browser tests. Its two
sandbox-incompatible DPAPI round trips passed in a separately approved normal
desktop test with synthetic credentials and no skipped round trips.

Targeted private real observations: four positive joins (three unchanged long-
field joins and one new short-field join), eight fresh original-code crop reads,
68 complete foreign-page-body substitutions and 68 duplicated-body corpora.
All substituted/duplicated cases were rejected; source hashes stayed unchanged.
The body observations were reused, so these are NOT 136 new OCR runs or orders.
Targeted check duration: 15.117 seconds.

A separate full-ink SIFT experiment made 36 comparisons in 122.688 seconds but
did not resolve the dense red paper. That experiment was NOT adopted; production
geometry/worker hashes and geometric safety thresholds remain unchanged.

Frozen candidate recognition fingerprint:
`df6a5dbaf8f741fc4e302e70db03d9ebb97cfc970c27d1a570bf1dc0c5afbed7`.

## Complete historical-day replay

The complete isolated June 10 replay finished in 495.339 seconds: 21 photos,
five PDFs / 18 pages, **15/21 assigned, previously 14/21**. The new correspondence
is the physically inspected PDF page 5 / observed number 190. All fourteen prior
photo-hash/target mappings and all original code observations/audits are unchanged.
There were 31 fresh body reads, zero body-cache hits and zero reference-number
disagreements. The known actual-186/wrong-188 counterexample is still excluded.

A separate isolated copy then completed fifteen real JPEG transactions (twelve
blessing photos, two lamp scenes and one water scene). Two independent new
processes accepted the intact receipt; three rejected output replacement, PDF
replacement and a missing receipt. All six excluded original copies and all
replay/source inputs retained their hashes. No NAS or online write occurred.

Six photos remain unresolved (five lack qualified complete-code evidence, one
has insufficient corroborated body fields). `ready` remains false. This is not
an assertion that the day, year or online business is complete. The previous
March replay has not been rerun with this new fingerprint in this round.

Existing real pinned-runtime generated-image positioned integration passed:
one fresh join, eleven rejection checks, four restart checks and 24 position
tests, 24.716 seconds. It is not an OCR-accuracy test.

Final frozen-year, clean-PC, online and release gates remain outstanding. The
unchanged launcher, date defaults and manual CAPTCHA are not affected.
