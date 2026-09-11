"""Bounded local geometry worker; no page assignment, network or user settings."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

import cv2 as cv
import numpy as np


def implementation():
    spec = importlib.util.spec_from_file_location('printed_layout_geometry',
        Path(__file__).with_name('printed_layout_geometry.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def runtime_check():
    root = Path(sys.executable).resolve().parent
    local_imports = all(not getattr(m, '__file__', None)
        or Path(m.__file__).resolve().is_relative_to(root) for m in list(sys.modules.values())
        if getattr(m, '__name__', '') != '__main__')
    local_paths = all(Path(p).resolve().is_relative_to(root) for p in sys.path)
    if (sys.version_info[:3] != (3, 12, 14) or np.__version__ != '2.3.5'
            or cv.__version__ != '4.13.0' or not sys.flags.isolated
            or not sys.flags.no_site or not local_imports or not local_paths):
        raise ValueError('Runtime identity mismatch')
    cv.setNumThreads(1)
    cv.ocl.setUseOpenCL(False)
    return dict(python='3.12.14', numpy=np.__version__, opencv=cv.__version__,
                isolated=True, noSite=True, localImports=True, localSearchPaths=True)


def run(request):
    runtime = runtime_check()
    if not isinstance(request, dict) or request.get('schemaVersion') != 1:
        raise ValueError('Invalid request')
    g = implementation()
    if request.get('operation') == 'smoke':
        source = np.full((400, 600), 240, np.uint8)
        rng = np.random.default_rng(713)
        for x, y, r in rng.integers([12, 12, 2], [588, 388, 7], (350, 3)):
            cv.circle(source, (int(x), int(y)), int(r), 20, -1)
        target = np.full((600, 800), 240, np.uint8)
        target[100:500, 100:700] = source
        result = g.match_layout(g.prepare_template(source, 'printed-ink'), g.prepare_photo(target))
        if not result['candidate']:
            raise ValueError('Runtime computation failed')
        return dict(schemaVersion=1, complete=True, operation='smoke', runtime=runtime,
                    geometryComputed=True, mayAssignNumber=False)
    if request.get('operation') != 'match':
        raise ValueError('Unknown operation')
    pages, photos = request.get('pages'), request.get('photos')
    if (not isinstance(pages, list) or not isinstance(photos, list)
            or not 1 <= len(pages) <= 32 or not 1 <= len(photos) <= 8):
        raise ValueError('Request budget exceeded')
    root = Path(request['inputRoot'])
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise ValueError('Invalid input root')
    root = root.resolve(strict=True)
    loaded, seen, seen_files = {}, set(), set()
    for item in pages + photos:
        if (not isinstance(item, dict) or not re.fullmatch(r'[a-f0-9]{64}(?::[1-9][0-9]{0,4})?', item.get('id', ''))
                or item['id'] in seen or not re.fullmatch(r'image-[0-9]+\.png', item.get('file', ''))
                or item['file'] in seen_files or not re.fullmatch(r'[a-f0-9]{64}', item.get('sha256', ''))):
            raise ValueError('Invalid or duplicate image identity')
        seen.add(item['id'])
        seen_files.add(item['file'])
        file = root/item['file']
        if file.is_symlink() or not file.is_file() or file.stat().st_size > 20_000_000:
            raise ValueError('Invalid image file')
        data = file.read_bytes()
        if not data.startswith(b'\x89PNG\r\n\x1a\n') or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('Image integrity mismatch')
        image = cv.imdecode(np.frombuffer(data, np.uint8), cv.IMREAD_GRAYSCALE)
        if image is None or min(image.shape) < 32 or max(image.shape) > 1800:
            raise ValueError('Image pixel budget exceeded')
        loaded[item['id']] = image
    templates = [(p, g.prepare_template(loaded[p['id']], 'printed-ink')) for p in pages]
    results = []
    for photo in photos:
        observed = g.prepare_photo(loaded[photo['id']])
        matches = [dict(id=p['id'], imageSha256=p['sha256'], shape=list(template['shape']),
                        evidence=g.match_layout(template, observed)) for p, template in templates]
        results.append(dict(id=photo['id'], imageSha256=photo['sha256'], shape=list(observed['shape']), pages=matches))
    for item in pages + photos:
        file = root/item['file']
        if file.is_symlink() or hashlib.sha256(file.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('Image changed during computation')
    return dict(schemaVersion=1, complete=True, operation='match', runtime=runtime,
                results=results, mayAssignNumber=False, mayClearCodeConflict=False,
                parameters=g.PARAMETERS, coordinateFrame='printed-ink')


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(1_000_001)
        if len(raw) > 1_000_000:
            raise ValueError('Request too large')
        output = run(json.loads(raw))
        output['requestSha256'] = hashlib.sha256(raw).hexdigest()
        print(json.dumps(output, ensure_ascii=True, allow_nan=False), flush=True)
    except Exception:
        print(json.dumps(dict(schemaVersion=1, complete=False, reason='layout-worker-failed')), flush=True)
        raise SystemExit(1)
