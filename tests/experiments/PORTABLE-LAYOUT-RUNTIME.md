# App-local printed-layout computation

2026-09-12. This completes a prerequisite for positioned tablet adjudication;
it does not assign the two unresolved tablets, finish annual acceptance or
authorize a software release.

## Change and boundaries

The earlier geometric experiment depended on a developer TEMP OpenCV install.
The app now has an explicit, lazy local-worker API and an offline runtime
staging tool. No Python process starts just by importing the module or opening
the existing UI. The actual photo collector is not connected to this API yet.

The runtime bundle is Windows x64 Python 3.12.14, NumPy 2.3.5 and headless
OpenCV 4.13.0 (wheel 4.13.0.92). It contains 1,135 allowlisted files totaling
182,226,414 bytes, including the supplied Python, NumPy, OpenCV and third-party
license notices. No developer package environment, browser state, credentials,
customer files or absolute local settings are packaged. Binaries are private
release assets, not committed to Git.

- The exact manifest hash is pinned in `src/layout-runtime-lock.mjs`:
  `dcc6c12f4356036c8e6c58cdd34ab681288ec8245a6fe63d8e8037770897dcc5`.
- All included files are checked before and after worker execution; unexpected
  files, symlinks, changed sizes/hashes and altered worker sources fail closed.
- Python uses an app-relative `python312._pth` with no `import site`, plus
  `-I -B -S`. The subprocess environment excludes host Python paths and secrets.
  Python documents this isolation behavior in its
  [module search path reference](https://docs.python.org/3.12/library/sys_path_init.html#pth-files).
- The worker is hidden, has a bounded timeout and uses one CPU thread/no OpenCL.
  It receives only private derived PNGs with exact hashes and opaque source IDs.
  A call is limited to 32 pages and 8 photos; larger callers must batch explicitly
  without dropping pages from their separate whole-corpus uniqueness check.
- Failures expose fixed messages, not raw exception text or image content.
  Only a fresh, unchanged in-process response retains its observation seal;
  deserializing/editing a response does not confer that seal.
- The existing geometry algorithm moved byte-for-byte to
  `src/printed_layout_geometry.py`, hash
  `8a780b22f1d973fbb4a61f586bf2ddf28372f29d2d35a307f38808eed73feb07`.
  Old experiment imports forward to it; frozen experiment snapshots copy/hash
  the actual implementation, not the forwarding module.
- Every geometry result still has `mayAssignNumber`, `mayClearCodeConflict`,
  `bindingVerified`, physical-paper and foreground authority set to false.
  Repeated decoration is useful for location, not identity.

## Actual verification

1. The new runtime-tree suite initially failed because its implementation was
   missing; all three cases pass now. Two protocol tests cover exact request/image sets, non-authority and
   malformed inputs. The release gate regression also began red: the old gate
   would pass without this runtime. A required asset integration stage now
   precedes the existing mandatory Windows suite; annual/online acceptance
   remains separately required.
2. A real 182 MB bundle was staged into a new temporary app snapshot, verified
   idempotently, and moved to a directory containing spaces and Chinese text.
   Two actual smoke computations and one generated-image geometric match
   passed, including poisoned host `PYTHONHOME`/`PYTHONPATH`. Six negative cases
   rejected changed executable/path configuration/worker code, an unexpected
   file, timeout and corrupt image data. Total integration window: 38.672 s.
3. The moved snapshot processed both real tablet images against all 16 rendered
   PDF pages: 32 comparisons, 32 evidence records exactly equal to the preceding
   experiment, 4 geometric proposals. This took 85.897 s while ordinary tests
   also ran; it is not a controlled speed comparison. Hashes of the 20 input
   photo copies, 4 PDF copies and all derived PNGs were unchanged.
4. The bundled interpreter passed all 12 existing geometry tests and 12
   positioned-field probe tests. Final full Windows regression passed 207
   ordinary Node tests plus process/UI, DPAPI, actual OCR/model/cache and four
   local browser cases, no skips. The asset integration is explicit and is not
   silently included in that 207 count.

Tested recognition fingerprint:
`7ba6229af5a4d2e8c255f0ee6d186b21f1901c42523df340df3ef72cd1362e7c`.

```text
NODE tools/collect-layout-runtime.mjs PYTHON_ROOT OPENCV_PACKAGE_ROOT PRIVATE_CANDIDATE_PARENT
NODE tools/stage-layout-runtime.mjs REVIEWED_LAYOUT_BUNDLE ISOLATED_APP_SNAPSHOT
NODE tests/layout-runtime-integration.mjs REVIEWED_LAYOUT_BUNDLE
BUNDLED_PYTHON -I -B -S tests/experiments/printed-layout-regions-tests.py
BUNDLED_PYTHON -I -B -S tests/experiments/positioned-field-probe-tests.py
NODE tests/run-tests.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ui/Run-Tests.ps1
```

The collector CLI creates only a candidate; its self-produced manifest is not
trusted for execution until it matches the separately pinned runtime hash.
Staging never overwrites a different existing runtime. Failed unique staging
folders are retained for inspection rather than recursively deleting contents.

## Still open

This is relocation/isolation on the same host, **not a clean second-computer
test**. The last complete hard-day photo plan remains the earlier 17/20, with
two tablet candidates and one strong prefix conflict unresolved. Position,
original code and current physical PDF/source hashes must be joined in the
actual collector, followed by full-plan/restart checks, other failing dates and
frozen annual replay. Existing launcher/date defaults/manual login are unchanged.
No new release tag, production deployment, upload or original-photo edit occurred.
