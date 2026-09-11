"""Fixed code-window projection from independently observed body positions.

Diagnostic pixels only: a body fit does not prove header extrapolation or code
identity. No expected code, OCR result, file name or missing-slot input.
"""
import cv2 as cv
import numpy as np

RECIPE = 'body-homography-fixed-pdf-code-window-v1'
RULE_RECIPE = 'red-otsu-first-70percent-horizontal-rule-v1'
WINDOWS = {
    'landscape-line': (.830, .004, .160, .043),
    'landscape-wide': (.790, .000, .205, .070),
    'portrait-line': (.610, .005, .350, .032),
    'portrait-wide': (.620, .000, .350, .095),
}


def project_window(image, matrix, page_width, page_height, window_name):
    if (not isinstance(image, np.ndarray) or image.dtype != np.uint8
            or image.ndim != 3 or image.shape[2] != 3 or min(image.shape[:2]) < 2):
        raise ValueError('Oriented three-channel uint8 image required')
    if not (np.isfinite(page_width) and np.isfinite(page_height)
            and page_width > 0 and page_height > 0):
        raise ValueError('Positive physical PDF dimensions required')
    if window_name not in WINDOWS:
        raise ValueError('Fixed code window required')
    if window_name.startswith('portrait') != (page_height > page_width):
        raise ValueError('Window must match physical PDF orientation')
    h = np.asarray(matrix, dtype=np.float64)
    if h.shape != (3, 3) or not np.isfinite(h).all() or abs(np.linalg.det(h)) < 1e-12:
        raise ValueError('Finite invertible normalized homography required')
    x, y, w, height = WINDOWS[window_name]
    corners = np.float64([[x, y], [x+w, y], [x+w, y+height], [x, y+height]])
    d = np.column_stack([corners, np.ones(4)]) @ h[2]
    if min(abs(d)) < 1e-8 or not (np.all(d > 0) or np.all(d < 0)):
        raise ValueError('Projective pole in header')
    projected = cv.perspectiveTransform(corners.reshape(-1, 1, 2), h).reshape(-1, 2)
    if (not np.isfinite(projected).all() or np.any(projected < 0) or np.any(projected > 1)
            or not cv.isContourConvex(projected.astype(np.float32))
            or cv.contourArea(projected.astype(np.float32), oriented=True) <= 0):
        raise ValueError('Header outside source or reflected; do not clip/fill it')
    scale = 1800 / max(page_width, page_height)
    pw, ph = page_width * scale, page_height * scale
    width_out, height_out = int(np.ceil(w*pw)), int(np.ceil(height*ph))
    pdf_to_output = np.float64([[pw, 0, -x*pw], [0, ph, -y*ph], [0, 0, 1]])
    photo_to_normal = np.diag([1/image.shape[1], 1/image.shape[0], 1.])
    matrix_out = pdf_to_output @ np.linalg.inv(h) @ photo_to_normal
    pixels = cv.warpPerspective(image, matrix_out, (width_out, height_out),
                                flags=cv.INTER_CUBIC, borderMode=cv.BORDER_CONSTANT)
    return pixels, dict(recipe=RECIPE, window=window_name, sourceQuad=projected.tolist(),
                        outputSize=[width_out, height_out], matrix=matrix_out.tolist(),
                        extrapolationVerified=False, physicalCodeExtentVerified=False,
                        mayAssign=False, mayClearCodeConflict=False)


def isolate_above_rule(image):
    """Keep every dark component above the first long horizontal rule.

    Deliberately bounded/no OCR feedback. A touching glyph remains a conflict,
    not a digitally repaired digit; this is only another pixel observation.
    """
    if (not isinstance(image, np.ndarray) or image.dtype != np.uint8
            or image.ndim != 3 or image.shape[2] != 3 or min(image.shape[:2]) < 2):
        raise ValueError('Three-channel uint8 code window required')
    red = image[:, :, 2]  # OpenCV BGR
    threshold, binary = cv.threshold(red, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU)
    mask = binary != 0
    rows = np.flatnonzero(mask.mean(axis=1) >= .70)
    base = dict(recipe=RULE_RECIPE, threshold=float(threshold), mayAssign=False,
                physicalCodeExtentVerified=False, mayClearCodeConflict=False)
    # Demand two consecutive long rows, not a few strokes on one text line.
    starts = [int(y) for y in rows if y+1 in rows]
    if not starts:
        return None, dict(**base, status='no-horizontal-rule')
    bottom = starts[0]
    upper = mask[:bottom]
    if bottom < 4 or not upper.any():
        return None, dict(**base, status='no-text-above-rule')
    # A gap separates text from the rule. Do not cut a component attached to
    # the rule and then declare that its full character survived.
    gaps = np.flatnonzero(~upper.any(axis=1))
    if not len(gaps):
        return None, dict(**base, status='text-rule-separation-unproved')
    gap = int(gaps[-1])
    if gap != bottom-1:
        return None, dict(**base, status='text-rule-separation-unproved')
    ys, xs = np.nonzero(mask[:gap])
    if not len(xs):
        return None, dict(**base, status='no-isolated-text')
    left, top, right, low = int(xs.min()), int(ys.min()), int(xs.max())+1, int(ys.max())+1
    if low-top < 4 or right-left < 12 or not (2 <= (right-left)/(low-top) <= 25):
        return None, dict(**base, status='unsupported-line-shape')
    left, top, right, low = max(0,left-2), max(0,top-2), min(image.shape[1],right+2), min(gap+1,low+2)
    crop = red[top:low, left:right]
    # The white rim is explicit padding, never synthesized character ink.
    output = cv.copyMakeBorder(crop, 6, 6, 6, 6, cv.BORDER_CONSTANT, value=255)
    return output, dict(**base, status='isolated-observation', sourceRect=[left,top,right-left,low-top],
                        ruleStart=bottom, separatingBlankRow=gap, padding=6)
