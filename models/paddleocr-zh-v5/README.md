# Local prefix-only supplementary reader

PP-OCRv5 Chinese server recognition model, distributed by RapidAI/RapidOCR v3.9.2.
The model runs on local CPU; it is not a remote service. No runtime download,
network login or business-data transfer is involved.

- Source manifest: https://github.com/RapidAI/RapidOCR/blob/v3.9.2/python/rapidocr/default_models.yaml
- Artifact: https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_server.onnx
- SHA-256: `e09385400eaaaef34ceff54aeb7c4f0f1fe014c27fa8b9905d4709b65746562a`
- Size: 84,577,022 bytes.
- Project license: Apache-2.0; https://github.com/RapidAI/RapidOCR/blob/v3.9.2/LICENSE
- Preprocessing reference: https://github.com/RapidAI/RapidOCR/blob/v3.9.2/python/rapidocr/ch_ppocr_rec/main.py

48-pixel height, BGR/CHW, [-1,1], right zero padding, dynamic width 320–2048;
sharp linear interpolation, not claimed pixel-identical to OpenCV. The alphabet
is read from verified embedded model metadata; never substitute the English list.

Loaded lazily only after complete original reads establish a stable numeric tail,
the V4 supplemental original crops agree on one literal full code, and a single
prefix-character disagreement remains. Original contrary two-engine consensus
still vetoes. Both V5 crops must independently be recorded, not selected by a PDF
answer. V4 and V5 are not counted as independent votes. Specific current PDF body
evidence and all existing source, audit, duplicate, write and upload gates remain
mandatory. This model cannot repair suffix conflicts or assign a missing number.

Missing or changed model bytes leave these exceptional photos unresolved; they
do not prevent processing independently confirmed photos. Release smoke tests
require the exact bundled artifact. No claim of annual or online acceptance.
