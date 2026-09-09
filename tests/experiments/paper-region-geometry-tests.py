"""Generated images only. Explicit isolated dependency tests, never skipped."""
import importlib.util
import base64
import json
from pathlib import Path
import subprocess
import sys
import unittest
import cv2
import numpy as np

spec = importlib.util.spec_from_file_location('paper_regions', Path(__file__).with_name('paper-region-geometry.py'))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


class RegionTests(unittest.TestCase):
    def test_convex_corner_order_has_no_duplicate_on_diamond(self):
        diamond = [[100, 0], [200, 100], [100, 200], [0, 100]]
        for points in [diamond, diamond[::-1], diamond[1:]+diamond[:1]]:
            actual = g.order_quad(points)
            self.assertEqual(len(set(map(tuple, actual))), 4)
            self.assertGreater(cv2.contourArea(actual, oriented=True), 0)
        with self.assertRaises(ValueError):
            g.order_quad([[0, 0], [10, 10], [10, 0], [0, 10]])

    def test_same_hue_background_connected_by_stand_can_still_propose_board(self):
        image = np.full((600, 800, 3), (170, 45, 30), np.uint8)
        quad = np.int32([[130, 140], [670, 110], [650, 480], [120, 500]])
        cv2.fillPoly(image, [quad], (235, 70, 45))
        cv2.polylines(image, [quad], True, (30, 20, 20), 6)
        cv2.line(image, (400, 480), (400, 599), (235, 70, 45), 12)
        result = g.propose_regions(image)
        self.assertTrue(result['complete'])
        self.assertTrue(any(abs(r['areaFraction']-.41) < .05 for r in result['candidates']))
        for key in ['paperVerified', 'foregroundVerified', 'physicalCodeExtentVerified',
                    'bindingVerified', 'mayClearCodeConflict', 'mayAssignNumber', 'mayUploadScene']:
            self.assertFalse(result[key])

    def test_empty_or_rectangular_nonpaper_is_not_scene_or_paper_proof(self):
        self.assertEqual(g.propose_regions(np.zeros((80, 120, 3), np.uint8))['candidates'], [])
        image = np.zeros((300, 500, 3), np.uint8)
        cv2.rectangle(image, (100, 70), (400, 230), (100, 120, 170), -1)
        result = g.propose_regions(image)
        self.assertGreater(len(result['candidates']), 0)
        self.assertFalse(result['paperVerified'])

    def test_resize_mapback_and_rectification(self):
        image = np.zeros((1600, 2400, 3), np.uint8)
        cv2.rectangle(image, (600, 400), (1800, 1200), (220, 180, 70), -1)
        result = g.propose_regions(image)
        self.assertTrue(result['candidates'])
        q = np.asarray(result['candidates'][0]['points'])
        np.testing.assert_allclose(q.min(axis=0), [600, 400], atol=10)
        np.testing.assert_allclose(q.max(axis=0), [1800, 1200], atol=10)
        crop = g.rectify_region(image, q)
        self.assertLessEqual(max(crop.shape[:2]), 1024)
        self.assertAlmostEqual(crop.shape[1]/crop.shape[0], 1.5, delta=.05)
        self.assertGreater(crop[..., 0].mean(), 200)

    def test_nested_board_not_merged_and_budget_not_silent(self):
        rows = [{'points': [[10, 10], [100, 10], [100, 80], [10, 80]], 'sources': ['L']},
                {'points': [[11, 10], [101, 10], [101, 80], [11, 80]], 'sources': ['a']},
                {'points': [[25, 20], [85, 20], [85, 70], [25, 70]], 'sources': ['b']}]
        merged = g.merge_near_identical(rows)
        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0]['sources'], ['L', 'a'])
        image = np.zeros((600, 800, 3), np.uint8)
        for x in [60, 450]:
            cv2.rectangle(image, (x, 100), (x+220, 400), (220, 180, 80), -1)
        with self.assertRaisesRegex(ValueError, 'incomplete proposal'):
            g.propose_regions(image, max_candidates=1)

    def test_invalid_rgb_and_outside_quad(self):
        for image in [np.zeros((80, 80)), np.zeros((80, 80, 4), np.uint8), np.zeros((8, 8, 3), np.uint8)]:
            with self.assertRaises(ValueError):
                g.propose_regions(image)
        with self.assertRaises(ValueError):
            g.rectify_region(np.zeros((80, 100, 3), np.uint8), [[0, 0], [110, 0], [110, 50], [0, 50]])

    def test_actual_worker_isolates_bad_input_and_keeps_all_proposals(self):
        image = np.zeros((300, 500, 3), np.uint8)
        cv2.rectangle(image, (90, 60), (410, 240), (200, 100, 40), -1)
        ok, encoded = cv2.imencode('.png', image)
        self.assertTrue(ok)
        requests = [{'id': 0, 'pngBase64': 'invalid'},
                    {'id': 1, 'pngBase64': base64.b64encode(encoded).decode('ascii')}]
        run = subprocess.run([sys.executable, '-B', str(Path(__file__).with_name('paper-region-worker.py'))],
                             input=''.join(json.dumps(r)+'\n' for r in requests),
                             capture_output=True, text=True, timeout=30)
        self.assertEqual(run.returncode, 0)
        self.assertEqual(run.stderr, '')
        rows = [json.loads(line) for line in run.stdout.splitlines()]
        self.assertEqual([r['id'] for r in rows], [0, 1])
        self.assertFalse(rows[0]['complete'])
        self.assertTrue(rows[1]['complete'])
        self.assertGreater(len(rows[1]['candidates']), 0)
        self.assertFalse(rows[1]['mayAssignNumber'])
        for row in rows[1]['candidates']:
            crop = cv2.imdecode(np.frombuffer(base64.b64decode(row['pngBase64']), np.uint8), cv2.IMREAD_COLOR)
            self.assertIsNotNone(crop)
            self.assertLessEqual(max(crop.shape[:2]), 512)

    def test_large_valid_png_keeps_request_identity_and_is_not_transport_rejected(self):
        # A valid 12 MP image can exceed the old 20 MB PNG / 30 MB JSON
        # transport limits. Generated noise, no business image in this test.
        image = np.random.default_rng(123).integers(0, 256, (3000, 4000, 3), dtype=np.uint8)
        ok, encoded = cv2.imencode('.png', image)
        self.assertTrue(ok)
        self.assertGreater(encoded.nbytes, 20_000_000)
        payload = json.dumps({'id': 2, 'pngBase64': base64.b64encode(encoded).decode('ascii')})+'\n'
        self.assertGreater(len(payload), 30_000_000)
        run = subprocess.run([sys.executable, '-B', str(Path(__file__).with_name('paper-region-worker.py'))],
                             input=payload, capture_output=True, text=True, timeout=45)
        self.assertEqual(run.returncode, 0)
        row = json.loads(run.stdout)
        self.assertEqual(row['id'], 2)
        self.assertNotIn(row.get('errorCode'), ['REQUEST_TOO_LARGE', 'PNG_TOO_LARGE'])
        self.assertFalse(row['mayAssignNumber'])


if __name__ == '__main__':
    cv2.setNumThreads(1)
    unittest.main()
