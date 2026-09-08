# Copyright (c) 2020 PaddlePaddle Authors. All Rights Reserved.
# Copyright (c) 2026 qifu-dailywork contributors.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Offline reference geometry, NOT a production assignment path.

Adapted from PaddleOCR release/2.7 ppocr/postprocess/db_postprocess.py
and tools/infer/utility.py. Quad fast-score, no dilation, threshold .3,
box threshold .6 and unclip ratio 1.5 match its inference CLI defaults.
Changes: numpy-only map input; reject truncated candidate sets/bad maps;
OpenCV rectangle area/perimeter instead of shapely for the same quad;
return diagnostic provenance and do not auto-rotate vertical crops.
Caller supplies installed cv2/pyclipper via an isolated PYTHONPATH.
"""
import cv2
import numpy as np
import pyclipper


def mini_box(contour):
    rect = cv2.minAreaRect(np.asarray(contour, dtype=np.float32))
    points = sorted(cv2.boxPoints(rect), key=lambda p: p[0])
    left = sorted(points[:2], key=lambda p: p[1])
    right = sorted(points[2:], key=lambda p: p[1])
    return np.asarray([left[0], right[0], right[1], left[1]], np.float32), min(rect[1])


def fast_score(prob, quad):
    h, w = prob.shape
    lo = np.maximum(0, np.floor(quad.min(axis=0)).astype(int))
    hi = np.minimum([w-1, h-1], np.ceil(quad.max(axis=0)).astype(int))
    if np.any(hi < lo):
        return 0.0
    mask = np.zeros((hi[1]-lo[1]+1, hi[0]-lo[0]+1), np.uint8)
    cv2.fillPoly(mask, [(quad-lo).astype(np.int32)], 1)
    return cv2.mean(prob[lo[1]:hi[1]+1, lo[0]:hi[0]+1], mask)[0]


def reference_quads(prob, dest_width, dest_height, *, threshold=.3,
                    min_score=.6, unclip_ratio=1.5, max_candidates=1000):
    prob = np.asarray(prob, dtype=np.float32)
    if prob.ndim != 2 or min(prob.shape) < 1 or not np.isfinite(prob).all() \
            or np.any(prob < 0) or np.any(prob > 1):
        raise ValueError('invalid DB map')
    if not all(isinstance(n, int) and n > 0 for n in [dest_width, dest_height, max_candidates]):
        raise ValueError('invalid geometry dimensions')
    if not 0 < threshold < 1 or not 0 < min_score <= 1 or not 0 < unclip_ratio <= 3:
        raise ValueError('invalid DB parameters')
    contours, _ = cv2.findContours((prob > threshold).astype(np.uint8)*255,
                                   cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    if len(contours) > max_candidates:
        raise ValueError('incomplete DB candidate set')
    h, w = prob.shape
    result = []
    for contour in contours:
        inner, side = mini_box(contour)
        if side < 3:
            continue
        score = fast_score(prob, inner)
        if score < min_score:
            continue
        perimeter = cv2.arcLength(inner, True)
        if perimeter <= 0:
            continue
        distance = cv2.contourArea(inner)*unclip_ratio/perimeter
        offset = pyclipper.PyclipperOffset()
        offset.AddPath(inner.tolist(), pyclipper.JT_ROUND, pyclipper.ET_CLOSEDPOLYGON)
        paths = offset.Execute(distance)
        if len(paths) != 1:
            continue
        expanded, side = mini_box(np.asarray(paths[0], np.float32))
        if side < 5:
            continue
        points = expanded.copy()
        points[:, 0] = np.clip(np.round(points[:, 0]/w*dest_width), 0, dest_width)
        points[:, 1] = np.clip(np.round(points[:, 1]/h*dest_height), 0, dest_height)
        result.append({'points': points.astype(int).tolist(), 'score': float(score),
                       'innerMapQuad': inner.tolist(), 'unclipDistanceMapPx': distance,
                       'physicalCodeExtentVerified': False, 'mayClearCodeConflict': False})
    return result


def rectify(image, points):
    points = np.asarray(points, np.float32)
    if points.shape != (4, 2) or not np.isfinite(points).all():
        raise ValueError('invalid crop quad')
    width = int(max(np.linalg.norm(points[0]-points[1]), np.linalg.norm(points[2]-points[3])))
    height = int(max(np.linalg.norm(points[0]-points[3]), np.linalg.norm(points[1]-points[2])))
    if width < 1 or height < 1:
        raise ValueError('empty crop')
    target = np.float32([[0, 0], [width, 0], [width, height], [0, height]])
    return cv2.warpPerspective(image, cv2.getPerspectiveTransform(points, target),
                               (width, height), flags=cv2.INTER_CUBIC,
                               borderMode=cv2.BORDER_REPLICATE)
