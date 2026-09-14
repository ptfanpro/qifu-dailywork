# Strict body second-evidence repair

## Problem

The annual blind replay exposed a routing gap rather than an isolated image
exception. A photo could contain one complete in-prefix code observation while
the other fixed code crops were blank or incomplete. The previous gate rejected
that item before the current-PDF body reader could provide independent page
identity. This accounted for a repeated class of formerly assigned items that
became unresolved under the stricter evidence policy.

## Resolution

One complete code may now nominate a page only when every complete observation
contains the same full code and the code identifies exactly one page in the
current PDF index. Nomination is not authorization. Resolution additionally
requires three distinct, disjoint, paired whole-field observations tied to that
same physical current PDF page.

The route fails closed when any complete opposite code exists, even at low
confidence, or when the prefix, page binding, body source, field count,
disjointness, reader result, or PDF membership check fails. The existing
alternate-model review retains priority; this fallback cannot suppress stronger
evidence. Raw OCR observations are retained without rewriting.

Policy identifier:

`single-code-view-plus-three-disjoint-whole-fields-v1`

## Regression coverage

The regression suite covers the positive route plus opposite code, foreign
prefix, wrong page, code outside the PDF, two-field-only evidence, failed body
views, immutable raw audit, current source/PDF byte binding, downstream PDF
recheck, and alternate-model priority.

The full Windows gate passed 242 tests with zero failures and zero skips, plus
runtime-location, process-safety, UI state, long-path OCR, bundled Chinese and
English model, cache identity, and local browser checks.

Three read-only full-day blind replays were compared against the preceding
frozen candidate. One day gained two assignments with no loss or reassignment;
two other days remained unchanged. All three had zero historical-reference
disagreements and unchanged photo/PDF source sets. These samples justify a
versioned repair checkpoint, not a release: a new frozen full-year replay and
the cross-machine and online gates are still required.
