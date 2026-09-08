"""Explicit isolated-dependency tests; not silently skipped by normal Node tests."""
import unittest
import importlib.util
from pathlib import Path
import cv2
import numpy as np

spec = importlib.util.spec_from_file_location('db_geometry', Path(__file__).with_name('db-reference-geometry.py'))
geometry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry)


class GeometryTests(unittest.TestCase):
    def test_inner_map_is_expanded_not_treated_as_whole_glyph(self):
        prob = np.zeros((64, 160), np.float32)
        prob[25:35, 40:120] = .95
        quads = geometry.reference_quads(prob, 160, 64)
        self.assertEqual(len(quads), 1)
        points = np.array(quads[0]['points'])
        self.assertLess(points[:, 0].min(), 40)
        self.assertGreater(points[:, 0].max(), 119)
        self.assertLess(points[:, 1].min(), 25)
        self.assertGreater(points[:, 1].max(), 34)
        self.assertFalse(quads[0]['physicalCodeExtentVerified'])
        self.assertFalse(quads[0]['mayClearCodeConflict'])

    def test_rotated_quad_rectification_preserves_foreground(self):
        prob = np.zeros((160, 200), np.float32)
        box = cv2.boxPoints(((100, 80), (100, 12), 18)).astype(np.int32)
        cv2.fillPoly(prob, [box], .95)
        quads = geometry.reference_quads(prob, 200, 160)
        self.assertEqual(len(quads), 1)
        points = np.array(quads[0]['points'])
        self.assertGreater(abs(int(points[1, 1])-int(points[0, 1])), 15)
        image = np.full((160, 200, 3), 255, np.uint8)
        cv2.fillPoly(image, [box], (0, 0, 0))
        crop = geometry.rectify(image, points)
        self.assertGreater(crop.shape[1]/crop.shape[0], 3)
        yy, xx = np.where(crop.mean(axis=2) < 50)
        self.assertGreater(xx.min(), 0)
        self.assertLess(xx.max(), crop.shape[1]-1)
        self.assertGreater(yy.min(), 0)
        self.assertLess(yy.max(), crop.shape[0]-1)

    def test_empty_invalid_maps_and_parameters(self):
        self.assertEqual(geometry.reference_quads(np.zeros((8, 8)), 8, 8), [])
        for prob in [np.zeros((1, 2, 3)), np.zeros((0, 4)), np.full((8, 8), np.nan), np.full((8, 8), 2)]:
            with self.assertRaises(ValueError):
                geometry.reference_quads(prob, 8, 8)
        with self.assertRaises(ValueError):
            geometry.reference_quads(np.zeros((8, 8)), 0, 8)

    def test_boundary_mapping_and_candidate_budget(self):
        prob = np.zeros((64, 80), np.float32)
        prob[0:10, 0:60] = .95
        points = np.array(geometry.reference_quads(prob, 160, 128)[0]['points'])
        self.assertGreaterEqual(points.min(), 0)
        self.assertLessEqual(points[:, 0].max(), 160)
        self.assertLessEqual(points[:, 1].max(), 128)
        prob[30:40, 10:70] = .95
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            geometry.reference_quads(prob, 80, 64, max_candidates=1)


if __name__ == '__main__':
    unittest.main()
