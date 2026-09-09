"""Explicit isolated OpenCV tests; synthetic data only, no skipped tests."""
import importlib.util
from pathlib import Path
import unittest
import tempfile
import subprocess
import sys
import json
import hashlib
import cv2 as cv
import numpy as np

spec = importlib.util.spec_from_file_location('layout', Path(__file__).with_name('printed-layout-regions.py'))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


def page(seed=713):
    image = np.full((600, 800), 245, np.uint8)
    rng = np.random.default_rng(seed)
    for _ in range(500):
        x, y = rng.integers([12, 12], [788, 588])
        cv.circle(image, (int(x), int(y)), int(rng.integers(2, 7)), int(rng.integers(0, 180)), -1)
    cv.rectangle(image, (15, 15), (784, 584), 30, 2)
    return image


class LayoutTests(unittest.TestCase):
    def test_white_canvas_is_not_printed_frame(self):
        source = np.full((900, 1500), 255, np.uint8)
        source[150:750, 350:1150] = page()
        matrix = np.float64([[1, .03, 60], [0, 1, 50], [0, 0, 1]])
        photo = cv.warpPerspective(source, matrix, (1700, 1100), borderValue=70)
        observed = g.prepare_photo(photo)
        old = g.match_layout(g.prepare_template(source), observed)
        self.assertFalse(old['candidate'])
        template = g.prepare_template(source, 'printed-ink')
        result = g.match_layout(template, observed)
        self.assertTrue(result['candidate'], result['reason'])
        x0, y0, x1, y1 = template['bounds']
        expected = cv.perspectiveTransform(np.float32([[x0, y0], [x1-1, y0],
            [x1-1, y1-1], [x0, y1-1]]).reshape(-1, 1, 2), matrix).reshape(-1, 2)
        np.testing.assert_allclose(result['geometry']['points'], expected, atol=3)
        self.assertEqual(result['geometry']['scope'], 'printed-content-envelope')
        self.assertTrue(result['localSupport']['observed'])
        self.assertFalse(result['localSupport']['completePageVerified'])
        for flag in ['paperVerified', 'foregroundVerified', 'physicalCodeExtentVerified',
                     'bindingVerified', 'mayClearCodeConflict', 'mayAssignNumber', 'mayUploadScene']:
            self.assertFalse(result[flag])

    def test_ink_outside_main_decoration_not_removed(self):
        source = np.full((600, 800), 255, np.uint8)
        cv.rectangle(source, (200, 100), (600, 500), 0, 4)
        cv.putText(source, 'TEST', (680, 40), cv.FONT_HERSHEY_SIMPLEX, .5, 0, 1)
        x0, y0, x1, y1 = g.printed_bounds(source)
        self.assertLess(y0, 40)
        self.assertGreater(x1, 700)
        self.assertLessEqual(x0, 200)
        self.assertGreaterEqual(y1, 500)
        self.assertIsNone(g.printed_bounds(np.full((600, 800), 255, np.uint8)))

    def test_partial_match_evidence_never_becomes_complete_page(self):
        s = np.float32([[20, 20], [120, 20], [120, 100], [20, 100], [60, 60]])
        result = g.local_support(np.eye(3), s, s)
        self.assertTrue(result['observed'])
        self.assertFalse(result['completePageVerified'])
        self.assertFalse(result['physicalCodeExtentVerified'])
        self.assertLessEqual(max(p[0] for p in result['projectedHull']), 120)
        self.assertFalse(g.geometry_evidence(np.eye(3), s, s, (600, 800), (900, 1200))['accepted'])
        mirror = np.float64([[-1, 0, 1000], [0, 1, 0], [0, 0, 1]])
        t = cv.perspectiveTransform(s.reshape(-1, 1, 2), mirror)
        self.assertFalse(g.local_support(mirror, s, t)['observed'])
        self.assertFalse(g.local_support(np.eye(3), s, s+20)['observed'])

    def test_projected_whole_page_recovered_not_only_body_box(self):
        source = page()
        target = np.float32([[170, 160], [970, 100], [1030, 740], [110, 780]])
        matrix = cv.getPerspectiveTransform(np.float32([[0, 0], [799, 0], [799, 599], [0, 599]]), target)
        photo = cv.warpPerspective(source, matrix, (1200, 900), borderValue=70)
        result = g.match_layout(g.prepare_template(source), g.prepare_photo(photo))
        self.assertTrue(result['candidate'], result['reason'])
        np.testing.assert_allclose(result['geometry']['points'], target, atol=3)
        for flag in ['paperVerified', 'foregroundVerified', 'physicalCodeExtentVerified',
                     'bindingVerified', 'mayClearCodeConflict', 'mayAssignNumber', 'mayUploadScene']:
            self.assertFalse(result[flag])

    def test_many_matches_on_one_logo_cannot_project_whole_page(self):
        s = np.float32([[20, 20], [120, 20], [120, 100], [20, 100], [60, 60]])
        result = g.geometry_evidence(np.eye(3), s, s, (600, 800), (900, 1200))
        self.assertFalse(result['accepted'])
        self.assertEqual(result['reason'], 'partial-layout-support')

    def test_no_descriptor_is_unknown_not_scene(self):
        blank = np.full((600, 800), 255, np.uint8)
        result = g.match_layout(g.prepare_template(page()), g.prepare_photo(blank))
        self.assertFalse(result['candidate'])
        self.assertFalse(result['mayUploadScene'])

    def test_body_only_paste_does_not_validate_border(self):
        source = page()
        photo = np.full((900, 1200), 70, np.uint8)
        photo[330:570, 380:820] = source[180:420, 180:620]
        result = g.match_layout(g.prepare_template(source), g.prepare_photo(photo))
        self.assertFalse(result['candidate'], result)

    def test_page_outside_photo_and_mirror_rejected(self):
        s = np.float32([[20, 20], [780, 20], [780, 580], [20, 580], [390, 580]])
        for matrix in [np.float64([[1, 0, -100], [0, 1, 0], [0, 0, 1]]),
                       np.float64([[-1, 0, 1000], [0, 1, 0], [0, 0, 1]])]:
            t = cv.perspectiveTransform(s.reshape(-1, 1, 2), matrix)
            self.assertFalse(g.geometry_evidence(matrix, s, t, (600, 800), (900, 1200))['accepted'])

    def test_invalid_gray_and_perimeter_excludes_body(self):
        for bad in [np.zeros((30, 80), np.uint8), np.zeros((600, 800, 3), np.uint8), np.zeros((600, 800))]:
            with self.assertRaises(ValueError):
                g.prepare_template(bad)
        mask = g.perimeter_mask((600, 800))
        self.assertEqual(mask[300, 400], 0)
        self.assertEqual(mask[30, 400], 255)

    def test_real_private_worker_hash_guard_and_protocol(self):
        with tempfile.TemporaryDirectory(prefix='qifu-layout-test-') as tmp:
            root = Path(tmp)
            image = page()
            ok, encoded = cv.imencode('.png', image)
            self.assertTrue(ok)
            data = encoded.tobytes()
            (root/'generated.png').write_bytes(data)
            record = dict(png='generated.png', pngSha256=hashlib.sha256(data).hexdigest())
            manifest = dict(days=[dict(date='synthetic-test',
                pages=[dict(**record, pdfSha256='a'*64, pageNumber=1)],
                photos=[dict(**record, sha256='b'*64)])])
            (root/'input.json').write_text(json.dumps(manifest), encoding='utf-8')
            run = subprocess.run([sys.executable, '-B', str(Path(__file__).with_name('printed-layout-worker.py')), tmp],
                                 capture_output=True, text=True, timeout=40)
            self.assertEqual(run.returncode, 0, run.stderr)
            rows = [json.loads(s) for s in run.stdout.splitlines()]
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0]['photoSha256'], 'b'*64)
            self.assertEqual(rows[-1]['kind'], 'worker-complete')
            self.assertFalse(rows[0]['bindingVerified'])
            ink = subprocess.run([sys.executable, '-B', str(Path(__file__).with_name('printed-layout-worker.py')), tmp, 'printed-ink'],
                                 capture_output=True, text=True, timeout=40)
            self.assertEqual(ink.returncode, 0, ink.stderr)
            ink_rows = [json.loads(s) for s in ink.stdout.splitlines()]
            self.assertEqual(ink_rows[-1]['coordinateFrame'], 'printed-ink')
            self.assertEqual(ink_rows[0]['pages'][0]['coordinateFrame'], 'printed-ink')
            self.assertFalse(ink_rows[0]['mayAssignNumber'])
            manifest['days'][0]['photos'][0]['pngSha256'] = 'c'*64
            (root/'input.json').write_text(json.dumps(manifest), encoding='utf-8')
            failed = subprocess.run([sys.executable, '-B', str(Path(__file__).with_name('printed-layout-worker.py')), tmp],
                                    capture_output=True, text=True, timeout=40)
            self.assertEqual(failed.returncode, 1)
            self.assertFalse(json.loads(failed.stdout)['complete'])
            self.assertNotIn(tmp, failed.stdout)


if __name__ == '__main__':
    cv.setNumThreads(1)
    unittest.main()
