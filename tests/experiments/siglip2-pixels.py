"""Offline image-only diagnostic preprocessing, never imported by production.

Pinned publisher config: SiglipImageProcessor, 224 x 224, Pillow bilinear,
rescale 1/255, mean/std .5. Full-frame is the canonical square resize; the
additional centered square crop is explicitly experimental and correlated.
No OCR, filename, expected role or PDF number influences either view.
"""
import numpy as np
from PIL import Image, ImageOps

VIEWS = ('center-crop', 'full-frame')

def image_values(image, view):
    if view not in VIEWS:
        raise ValueError('Unknown fixed view')
    im = ImageOps.exif_transpose(image)
    if 'A' in im.getbands() or 'transparency' in im.info:
        rgba = im.convert('RGBA')
        im = Image.alpha_composite(Image.new('RGBA', rgba.size, 'white'), rgba)
    im = im.convert('RGB')
    if view == 'center-crop':
        width, height = im.size
        side = min(width, height)
        left, top = (width - side) // 2, (height - side) // 2
        im = im.crop((left, top, left + side, top + side))
    im = im.resize((224, 224), resample=Image.Resampling.BILINEAR)
    array = np.asarray(im, dtype=np.float32) / np.float32(255)
    array = (array - np.float32(.5)) / np.float32(.5)
    return np.ascontiguousarray(array.transpose(2, 0, 1), dtype='<f4')
