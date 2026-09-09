"""Offline quadrilateral proposals, NOT a paper/scene classification.

Fixed first experiment: Lab channel edges, convex contour approximation.
No filename, OCR target, PDF page or historical role enters this function.
OpenCV contour/Canny primitives: https://docs.opencv.org/4.13.0/
Keep all eligible proposals (including nested boards/background); a quad is
not proof of paper, foreground, complete code extent or order identity.
Caller supplies isolated OpenCV; no dependency download or file mutation.
"""
import cv2
import numpy as np

PARAMETERS = dict(max_side=1280, canny_low=50, canny_high=150,
                  polygon_epsilon=.02, min_area_fraction=.01,
                  max_area_fraction=.85, min_side=24, max_aspect=4,
                  max_candidates=64, max_contours=20000,
                  paths=['contour', 'convex-hull-proposal'])


def order_quad(points):
    pts = np.asarray(points, np.float32)
    if pts.shape != (4, 2) or not np.isfinite(pts).all():
        raise ValueError('invalid quad')
    if not cv2.isContourConvex(pts) or abs(cv2.contourArea(pts)) < 1:
        raise ValueError('nonconvex or empty quad')
    # Contour vertices are cyclic. Preserve adjacency rather than assigning
    # corners independently by sum/difference (ties can repeat a corner).
    if cv2.contourArea(pts, oriented=True) < 0:
        pts = pts[::-1]
    start = min(range(4), key=lambda i: (float(pts[i].sum()), float(pts[i, 1]), float(pts[i, 0])))
    return np.roll(pts, -start, axis=0)


def merge_near_identical(proposals, tolerance=4):
    # Do not collapse a smaller paper into a larger board solely on overlap.
    merged = []
    for proposal in proposals:
        points = np.asarray(proposal['points'], np.float32)
        match = next((row for row in merged
                      if np.linalg.norm(np.asarray(row['points'])-points, axis=1).max() <= tolerance), None)
        if match is None:
            merged.append({**proposal, 'sources': list(proposal['sources'])})
        else:
            match['sources'] = sorted(set(match['sources']+proposal['sources']))
    return merged


def propose_regions(rgb, *, max_candidates=64, max_contours=20000):
    if not isinstance(rgb, np.ndarray) or rgb.dtype != np.uint8 or rgb.ndim != 3 \
            or rgb.shape[2] != 3 or min(rgb.shape[:2]) < 16 or max(rgb.shape[:2]) > 10000:
        raise ValueError('invalid RGB image')
    if not isinstance(max_candidates, int) or not 1 <= max_candidates <= 256 \
            or not isinstance(max_contours, int) or not 1 <= max_contours <= 100000:
        raise ValueError('invalid proposal budget')
    h, w = rgb.shape[:2]
    scale = min(1, PARAMETERS['max_side']/max(h, w))
    small = cv2.resize(rgb, (round(w*scale), round(h*scale)), interpolation=cv2.INTER_AREA) if scale < 1 else rgb.copy()
    sh, sw = small.shape[:2]
    channels = cv2.split(cv2.cvtColor(small, cv2.COLOR_RGB2Lab))
    proposals, counts = [], []
    for name, channel in zip(['L', 'a', 'b'], channels):
        edges = cv2.Canny(cv2.GaussianBlur(channel, (3, 3), 0), 50, 150, L2gradient=True)
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        counts.append(len(contours))
        if sum(counts) > max_contours:
            raise ValueError('incomplete contour coverage')
        # A partly interrupted physical border has inner/outer edge paths in
        # one concave contour. Its convex hull can propose the enclosing board;
        # this fills gaps, so it must NEVER be called a verified paper boundary.
        shapes = [(contour, name+'-contour') for contour in contours]
        shapes += [(cv2.convexHull(contour), name+'-convex-hull-proposal') for contour in contours]
        for contour, origin in shapes:
            perimeter = cv2.arcLength(contour, True)
            poly = cv2.approxPolyDP(contour, .02*perimeter, True)
            if len(poly) != 4 or not cv2.isContourConvex(poly):
                continue
            area_fraction = abs(cv2.contourArea(poly))/(sw*sh)
            if not .01 <= area_fraction <= .85:
                continue
            quad = order_quad(poly.reshape(4, 2))
            # Image boundary is not a detected physical paper boundary.
            if quad[:, 0].min() <= 1 or quad[:, 1].min() <= 1 \
                    or quad[:, 0].max() >= sw-2 or quad[:, 1].max() >= sh-2:
                continue
            lengths = np.linalg.norm(quad-np.roll(quad, 1, axis=0), axis=1)
            if lengths.min() < 24 or lengths.max()/lengths.min() > 4:
                continue
            quad[:, 0] *= w/sw
            quad[:, 1] *= h/sh
            proposals.append({'points': quad.tolist(), 'sources': [origin],
                              'areaFraction': float(area_fraction)})
    proposals.sort(key=lambda r: (-r['areaFraction'], r['points'], r['sources']))
    proposals = merge_near_identical(proposals, tolerance=4/scale)
    if len(proposals) > max_candidates:
        raise ValueError('incomplete proposal coverage')
    return {'schemaVersion': 1, 'imageWidth': w, 'imageHeight': h,
            'parameters': {**PARAMETERS, 'max_candidates': max_candidates, 'max_contours': max_contours},
            'contourCounts': counts, 'candidates': proposals, 'complete': True,
            'paperVerified': False, 'foregroundVerified': False,
            'physicalCodeExtentVerified': False, 'bindingVerified': False,
            'mayClearCodeConflict': False, 'mayAssignNumber': False, 'mayUploadScene': False}


def rectify_region(rgb, points, max_side=1024):
    quad = order_quad(points)
    h, w = rgb.shape[:2]
    if np.any(quad < 0) or quad[:, 0].max() >= w or quad[:, 1].max() >= h:
        raise ValueError('quad outside input')
    width = max(np.linalg.norm(quad[1]-quad[0]), np.linalg.norm(quad[2]-quad[3]))
    height = max(np.linalg.norm(quad[3]-quad[0]), np.linalg.norm(quad[2]-quad[1]))
    scale = min(1, max_side/max(width, height))
    ow, oh = max(2, round(width*scale)), max(2, round(height*scale))
    target = np.float32([[0, 0], [ow-1, 0], [ow-1, oh-1], [0, oh-1]])
    return cv2.warpPerspective(rgb, cv2.getPerspectiveTransform(quad, target), (ow, oh),
                               flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
