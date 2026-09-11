import importlib.util
from pathlib import Path
import unittest
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('pixels', Path(__file__).with_name('siglip2-pixels.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class PixelTests(unittest.TestCase):
    def test_published_normalization_and_chw(self):
        a = m.image_values(Image.new('RGB', (31, 17), (255, 0, 128)), 'full-frame')
        self.assertEqual(a.shape, (3, 224, 224))
        self.assertEqual(a.dtype, np.dtype('<f4'))
        self.assertTrue(np.all(a[0] == 1) and np.all(a[1] == -1))
        self.assertTrue(np.allclose(a[2], 128 / 127.5 - 1, atol=1e-7))

    def test_full_frame_keeps_edges_and_center_is_explicit(self):
        im = Image.new('RGB', (600, 200), 'black')
        im.paste('white', (0, 0, 100, 200))
        full = m.image_values(im, 'full-frame')
        center = m.image_values(im, 'center-crop')
        self.assertTrue(np.all(full[:, :, 0] == 1))
        self.assertTrue(np.all(center == -1))
        with self.assertRaises(ValueError): m.image_values(im, 'best-crop')

    def test_exif_applied_and_alpha_white_not_accidental_black(self):
        im = Image.new('RGB', (600, 200), 'black')
        im.paste('white', (0, 0, 100, 200)); im.getexif()[274] = 6
        a = m.image_values(im, 'full-frame')
        self.assertTrue(np.all(a[:, 0, :] == 1))
        clear = Image.new('RGBA', (5, 5), (0, 0, 0, 0))
        self.assertTrue(np.all(m.image_values(clear, 'full-frame') == 1))

if __name__ == '__main__': unittest.main()
