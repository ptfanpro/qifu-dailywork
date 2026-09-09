"""Private pixel-only pipe worker; never reads business paths or writes files."""
import base64
import importlib.util
import json
from pathlib import Path
import sys
import cv2
import numpy as np

spec = importlib.util.spec_from_file_location('paper_geometry', Path(__file__).with_name('paper-region-geometry.py'))
geometry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry)
cv2.setNumThreads(1)

for line in sys.stdin:
    ident = None
    try:
        # 30 MP RGB is at most 90 MB before PNG overhead and base64. Bound
        # encoded transport consistently with the pixel budget; a valid 12 MP
        # PNG already exceeded the former 20/30 MB transport pair.
        if len(line) > 128_000_000:
            raise ValueError('REQUEST_TOO_LARGE')
        request = json.loads(line)
        ident = request['id']
        if set(request) != {'id', 'pngBase64'} or not isinstance(ident, int):
            raise ValueError('invalid pixel request')
        data = base64.b64decode(request['pngBase64'], validate=True)
        if len(data) > 96_000_000:
            raise ValueError('PNG_TOO_LARGE')
        if not data.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('invalid pixel encoding')
        bgr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if bgr is None or bgr.size > 90_000_000:
            raise ValueError('invalid pixel image')
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        result = geometry.propose_regions(rgb)
        for row in result['candidates']:
            crop = geometry.rectify_region(rgb, row['points'], max_side=512)
            ok, encoded = cv2.imencode('.png', cv2.cvtColor(crop, cv2.COLOR_RGB2BGR))
            if not ok:
                raise ValueError('region encode failed')
            row['pngBase64'] = base64.b64encode(encoded).decode('ascii')
        print(json.dumps({'id': ident, 'cvVersion': cv2.__version__, 'numpyVersion': np.__version__, **result}), flush=True)
    except Exception as exc:
        # No raw exception may reveal customer paths or OCR content.
        safe_code = str(exc) if str(exc) in ['REQUEST_TOO_LARGE', 'PNG_TOO_LARGE'] else type(exc).__name__
        print(json.dumps({'id': ident, 'errorCode': safe_code,
                          'complete': False, 'mayAssignNumber': False, 'mayUploadScene': False}), flush=True)
