"""Read only derived, hash-checked PNGs in this explicit TEMP experiment."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import time
import cv2 as cv
import numpy as np

spec = importlib.util.spec_from_file_location('layout', Path(__file__).with_name('printed-layout-regions.py'))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


def run(root):
    cv.setNumThreads(1)
    started = time.monotonic()
    root = Path(root).resolve(strict=True)
    import tempfile
    temporary = Path(tempfile.gettempdir()).resolve(strict=True)
    if root == temporary or temporary not in root.parents:
        raise ValueError('Dedicated private TEMP directory required')
    manifest = json.loads((root/'input.json').read_text(encoding='utf-8'))

    def load(record):
        p = (root/record['png']).resolve(strict=True)
        if root not in p.parents:
            raise ValueError('Derived image escaped experiment')
        data = p.read_bytes()
        if hashlib.sha256(data).hexdigest() != record['pngSha256']:
            raise ValueError('Derived image changed')
        image = cv.imdecode(np.frombuffer(data, np.uint8), cv.IMREAD_GRAYSCALE)
        if image is None:
            raise ValueError('Derived PNG decode failed')
        return image

    for day in manifest['days']:
        templates = [(p, g.prepare_template(load(p))) for p in day['pages']]
        for photo in day['photos']:
            tick = time.monotonic()
            observed = g.prepare_photo(load(photo))
            rows = [dict(pdfSha256=p['pdfSha256'], pageNumber=p['pageNumber'],
                         **g.match_layout(template, observed)) for p, template in templates]
            print(json.dumps(dict(date=day['date'], photoSha256=photo['sha256'],
                measuredShape=list(observed['shape']), pages=rows, complete=True,
                seconds=time.monotonic()-tick, candidates=sum(r['candidate'] for r in rows),
                bindingVerified=False, mayAssignNumber=False, mayClearCodeConflict=False,
                mayUploadScene=False)), flush=True)
    print(json.dumps(dict(complete=True, kind='worker-complete', seconds=time.monotonic()-started,
                          parameters=g.PARAMETERS, opencv=cv.__version__)), flush=True)


if __name__ == '__main__':
    try:
        run(sys.argv[1])
    except Exception as error:
        # Do not expose paths, image contents or the full exception message.
        print(json.dumps(dict(complete=False, errorType=type(error).__name__)), flush=True)
        raise SystemExit(1)
