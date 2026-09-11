# English OCR model identity and unresolved-code investigation

Date: 2026-09-11. Development only; not a release or annual acceptance.

## Reproduced defect

Both English OCR entry points passed the language name `eng` and a local
language directory to Tesseract. The installed Tesseract.js loader reads an
existing `eng.traineddata` cache **before** the language directory. One entry
used the machine-state cache; the other used the default working-directory
cache. Therefore changing the application model did not guarantee changing
the loaded model. This is a reproducible upgrade/migration defect, not proof
that it caused every historical recognition failure.

`tests/english-model-cache-integration.mjs` creates a valid synthetic stale
cache by appending an inert marker to the bundled model. The old loader
actually loads those differing bytes. The corrected loader loads the exact
bundled bytes, reads a generated printed code, and leaves the old cache
unchanged. The production `createOcrWorker` entry is checked separately.

## Implemented correction

- Pin compressed and decompressed English model SHA-256 and byte length.
- Load only the explicit local model path with cache reads **and writes**
  disabled. No CDN fallback, credential access, system-language installation,
  or cache deletion.
- Check the bytes inside the initialized worker before configuring/returning
  it. This also detects a file change between initial validation and load.
- Close the worker if the inside-worker check or parameter setup fails.
- Route both English OCR entry points through this loader.
- Include the loader policy in source/runtime fingerprints. Observation-cache
  identity no longer depends on a machine cache that is not used.
- Preserve the existing model, recognition thresholds, raw conflicts, date
  defaults, launcher and online workflow.

The direct object-language/data API was tested but rejected: the installed
Tesseract.js initializer treats the binary data as the language name, leading
to a worker memory failure. The final implementation uses the tested local
path API plus inside-worker byte verification; it does not patch dependencies.

## Verification

Five unit regressions cover fixed local path/cache policy, same-size model
corruption, missing model/no fallback, parameter-failure cleanup, and different
bytes inside the worker. Tests were added before implementation; the initial
run failed, and the corrected implementation passes.

The real-engine cache integration independently reproduces the cache issue
and verifies the fix. It uses only generated text/model data, not customer
photos. It is included in `ui/Run-Tests.ps1`.

Final ordinary regression: 198 passed, zero failed/skipped. Full Windows
suite also passed: process/UI, generated long-path Windows OCR, Chinese-model
smoke, detection/observation cache, English-model cache and local browser tests.
These are development regression checks, not the outstanding release gates.

An offline fixed-crop comparison used 16 historical code-bearing photos and
64 identical detector crops, with the same model before/after the loader
change. All 64 text, confidence and parser outputs were identical (128 reads;
7.569 seconds), original hashes unchanged, external attempts zero. This is
loader equivalence, **not** 16 successful orders or an accuracy improvement.

## Alternatives investigated, not adopted

The seven unresolved photos had 28 fixed crops tested with actual Windows
OCR. No complete printed code was recovered. Only `zh-Hans-CN` was installed
on this machine. Repeating Windows OCR was not accepted as a remedy.

The official `tesseract-ocr/tessdata_best` English model was downloaded from
revision `e12c65a915945e4c28e237a9b52bc4a8f39a0cec`, with its Apache-2.0 license:

- 15,400,601 bytes
- SHA-256 `8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba`
- Source: https://github.com/tesseract-ocr/tessdata_best/tree/e12c65a915945e4c28e237a9b52bc4a8f39a0cec

The candidate failed in the installed WebAssembly runtime with a missing
`DotProductSSE` function, both normally and with the documented generic
dot-product initialization option. No candidate accuracy comparison finished.
The candidate remains private test data, is not in Git or the portable package,
and does not replace the existing model. Download and compatibility failures
are not successful recognition runs.

## Remaining gates

The seven original unresolved codes are still unresolved. The last complete
day plan remains 13/20 assigned, from the earlier frozen runtime, not this
loader revision. Further independent code/body evidence is required; weak
contrary observations were not deleted or promoted to pass. Frozen final-code
annual replay, real page/order verification, clean-computer packaging and all
release gates remain outstanding. No release/version bump or production write.
