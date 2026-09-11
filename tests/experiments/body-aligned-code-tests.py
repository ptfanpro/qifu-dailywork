import importlib.util
from pathlib import Path
import unittest
import numpy as np
import cv2 as cv

spec = importlib.util.spec_from_file_location('aligned_code', Path(__file__).with_name('body-aligned-code.py'))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


class ProjectionTests(unittest.TestCase):
    def setUp(self):
        self.image = np.zeros((1272, 1800, 3), np.uint8)
        self.image[:, :, 0] = np.arange(1800, dtype=np.int64)[None, :] % 251
        self.image[:, :, 1] = np.arange(1272, dtype=np.int64)[:, None] % 251

    def test_identity_keeps_fixed_pixel_location(self):
        out, meta = g.project_window(self.image, np.eye(3), 1800, 1272, 'landscape-wide')
        np.testing.assert_array_equal(out[:80, :360], self.image[:80, 1422:1782])
        self.assertFalse(meta['mayAssign'])
        self.assertFalse(meta['physicalCodeExtentVerified'])
        self.assertFalse(meta['extrapolationVerified'])

    def test_independent_backward_map_matches_warp(self):
        h = np.float64([[.55, .02, .2], [.01, .5, .25], [.02, .04, 1]])
        out, meta = g.project_window(self.image, h, 842, 595, 'landscape-line')
        xx, yy = np.meshgrid(np.arange(out.shape[1]), np.arange(out.shape[0]))
        x, y, _, _ = g.WINDOWS['landscape-line']
        p = np.stack([xx/1800+x, yy/(1800*595/842)+y, np.ones_like(xx)], axis=-1) @ h.T
        expected = cv.remap(self.image, (p[:,:,0]/p[:,:,2]*1800).astype(np.float32),
                            (p[:,:,1]/p[:,:,2]*1272).astype(np.float32), cv.INTER_CUBIC)
        self.assertLessEqual(int(np.abs(out.astype(int)-expected.astype(int)).max()), 1)

    def test_cannot_hide_outside_or_reflected_header_by_padding(self):
        for h in [[[1,0,.3],[0,1,0],[0,0,1]], [[-1,0,1],[0,1,0],[0,0,1]],
                  [[1,0,0],[0,1,0],[1,0,-.9]], [[0,0,0],[0,0,0],[0,0,0]]]:
            with self.assertRaises(ValueError):
                g.project_window(self.image, h, 842, 595, 'landscape-wide')

    def test_actual_page_aspect_controls_orientation(self):
        with self.assertRaises(ValueError):
            g.project_window(self.image, np.eye(3), 595, 842, 'landscape-wide')
        out, meta = g.project_window(self.image, np.eye(3), 595, 842, 'portrait-line')
        self.assertEqual(meta['outputSize'], [446, 58])

    def test_wrong_inputs_cannot_be_a_blank_success(self):
        for image in [self.image.astype(float), self.image[:,:,0], None]:
            with self.assertRaises(ValueError):
                g.project_window(image, np.eye(3), 842, 595, 'landscape-line')
        for dims in [(0,595),(842,float('nan'))]:
            with self.assertRaises(ValueError):
                g.project_window(self.image, np.eye(3), *dims, 'landscape-line')
        with self.assertRaises(ValueError):
            g.project_window(self.image, np.eye(3), 842, 595, 'answer-selected-window')

    def test_rule_separation_retains_all_ink_not_a_selected_answer(self):
        canvas = np.full((60,240,3), 255, np.uint8)
        cv.putText(canvas, '263-1-95', (20,30), cv.FONT_HERSHEY_SIMPLEX, .6, (0,0,0), 1)
        canvas[45:48] = 0
        out, meta = g.isolate_above_rule(canvas)
        self.assertEqual(meta['status'], 'isolated-observation')
        self.assertEqual(int(np.count_nonzero(out==0)), int(np.count_nonzero(canvas[:45,:,2]==0)))
        self.assertFalse(meta['physicalCodeExtentVerified'])
        self.assertFalse(meta['mayClearCodeConflict'])
        canvas[5:8,210:215] = 0  # extra ink is retained, never erased as noise
        out, meta = g.isolate_above_rule(canvas)
        self.assertEqual(int(np.count_nonzero(out==0)), int(np.count_nonzero(canvas[:45,:,2]==0)))

    def test_rule_touching_text_is_not_cut_into_a_successful_word(self):
        canvas = np.full((60,240,3), 255, np.uint8)
        canvas[0:48,40:45] = 0
        canvas[45:48] = 0
        out, meta = g.isolate_above_rule(canvas)
        self.assertIsNone(out)
        self.assertEqual(meta['status'], 'text-rule-separation-unproved')
        canvas = np.full((60,240,3),255,np.uint8)
        cv.putText(canvas, '263-1-95', (20,18), cv.FONT_HERSHEY_SIMPLEX, .5, (0,0,0), 1)
        canvas[25:48,100:105] = 0
        canvas[45:48] = 0
        out, meta = g.isolate_above_rule(canvas)
        self.assertIsNone(out, 'a blank gap must not hide lower ink connected to the rule')
        for canvas in [np.full((60,240,3),255,np.uint8), np.zeros((60,240,3),np.uint8)]:
            out, meta = g.isolate_above_rule(canvas)
            self.assertIsNone(out)

if __name__ == '__main__':
    unittest.main()
