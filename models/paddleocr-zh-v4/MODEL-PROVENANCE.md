# Local Chinese body observation assets

PaddleOCR PP-OCRv4 mobile models, distributed by RapidAI/RapidOCR v3.9.2.
Source manifest: https://github.com/RapidAI/RapidOCR/blob/v3.9.2/python/rapidocr/default_models.yaml
Project license: Apache-2.0, https://github.com/PaddlePaddle/PaddleOCR/blob/release/2.7/LICENSE

- `ch_PP-OCRv4_det_mobile.onnx`: `d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9`
- `ch_PP-OCRv4_rec_mobile.onnx`: `48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b`
- Recognition alphabet: 6,623 embedded model metadata entries; English dictionary is not substituted.

Models run locally on the existing CPU ONNX runtime. No runtime download or business-data transfer.
The body review is veto-only, never a highest-score-to-order binding. No deployment acceptance is implied.
Detector component proposals are not equivalent to the official DB polygon/unclip algorithm.
