"""Frozen diagnostic hypothesis: localize a page by outer printed features.

Unlike body-feature-probe, page identity is NEVER inferred. Repeated decoration
is useful for geometric proposals but cannot bind a photo to an order/page.
Input is already EXIF-oriented gray pixels. No filenames or OCR answers.
"""
import cv2 as cv
import numpy as np

PARAMETERS = dict(maxSide=1800, borderFraction=.18, templateFeatures=6000,
                  photoFeatures=10000, contrast=.02, ratio=.65,
                  ransacPixels=4, minInliers=10, minInlierRatio=.5,
                  minSpan=.6, minHullArea=.25, minQuadrants=4)


def gray(image):
    if not isinstance(image, np.ndarray) or image.dtype != np.uint8 or image.ndim != 2:
        raise ValueError('Expected oriented uint8 gray pixels')
    if min(image.shape) < 32 or image.size > 30_000_000:
        raise ValueError('Invalid pixel budget')
    scale = min(1., PARAMETERS['maxSide']/max(image.shape))
    if scale < 1:
        image = cv.resize(image, None, fx=scale, fy=scale, interpolation=cv.INTER_AREA)
    return image


def perimeter_mask(shape):
    h, w = shape
    margin = PARAMETERS['borderFraction']
    mask = np.full((h, w), 255, np.uint8)
    mask[int(h*margin):int(h*(1-margin)), int(w*margin):int(w*(1-margin))] = 0
    return mask


def prepare_template(image):
    image = gray(image)
    detector = cv.SIFT_create(nfeatures=PARAMETERS['templateFeatures'],
                              contrastThreshold=PARAMETERS['contrast'])
    points, descriptors = detector.detectAndCompute(image, perimeter_mask(image.shape))
    return dict(shape=image.shape, points=points, descriptors=descriptors)


def prepare_photo(image):
    image = gray(image)
    detector = cv.SIFT_create(nfeatures=PARAMETERS['photoFeatures'],
                              contrastThreshold=PARAMETERS['contrast'])
    image = cv.createCLAHE(clipLimit=2, tileGridSize=(8, 8)).apply(image)
    points, descriptors = detector.detectAndCompute(image, None)
    return dict(shape=image.shape, points=points, descriptors=descriptors)


def geometry_evidence(matrix, source_points, target_points, template_shape, photo_shape):
    """Check spatial support, not just a high inlier count in one small logo."""
    h, w = template_shape
    ph, pw = photo_shape
    s = np.asarray(source_points, np.float32).reshape(-1, 2)
    t = np.asarray(target_points, np.float32).reshape(-1, 2)
    if len(s) < 4 or len(s) != len(t) or not np.isfinite(s).all() or not np.isfinite(t).all():
        return dict(accepted=False, reason='insufficient-finite-support')
    normalized = s/np.float32([w, h])
    span = np.ptp(normalized, axis=0)
    hull = float(cv.contourArea(cv.convexHull(normalized)))
    quadrants = len(set(map(tuple, (normalized >= .5).astype(int))))
    result = dict(accepted=False, sourceSpan=span.tolist(), sourceHullArea=hull,
                  sourceQuadrants=quadrants)
    if not (np.isfinite(matrix).all() and matrix.shape == (3, 3)):
        return dict(**result, reason='invalid-transform')
    if min(span) < PARAMETERS['minSpan'] or hull < PARAMETERS['minHullArea'] or quadrants < 4:
        return dict(**result, reason='partial-layout-support')
    corners = np.float32([[0, 0], [w-1, 0], [w-1, h-1], [0, h-1]])
    denominators = np.column_stack([corners, np.ones(4)]) @ matrix[2]
    if np.min(np.abs(denominators)) < 1e-8 or not (np.all(denominators > 0) or np.all(denominators < 0)):
        return dict(**result, reason='projective-pole')
    q = cv.perspectiveTransform(corners.reshape(-1, 1, 2), matrix).reshape(-1, 2)
    if not np.isfinite(q).all() or not cv.isContourConvex(q) or cv.contourArea(q, oriented=True) <= 0:
        return dict(**result, reason='invalid-projected-quad')
    # Clipped paper is not a complete-page proposal. Do not clip it to image.
    if np.any(q < 0) or np.any(q[:, 0] > pw-1) or np.any(q[:, 1] > ph-1):
        return dict(**result, reason='projected-page-outside-photo')
    errors = np.linalg.norm(cv.perspectiveTransform(s.reshape(-1, 1, 2), matrix).reshape(-1, 2)-t, axis=1)
    if not np.isfinite(errors).all() or np.max(errors) > PARAMETERS['ransacPixels']*1.5:
        return dict(**result, reason='unstable-reprojection')
    result.update(accepted=True, reason='distributed-layout-proposal', points=q.tolist(),
                  reprojectionMedian=float(np.median(errors)), reprojectionMax=float(np.max(errors)),
                  areaFraction=float(cv.contourArea(q)/(pw*ph)))
    return result


def match_layout(template, photo):
    result = dict(templateFeatures=len(template['points']), photoFeatures=len(photo['points']),
                  ratioMatches=0, inliers=0, candidate=False, paperVerified=False,
                  foregroundVerified=False, physicalCodeExtentVerified=False,
                  bindingVerified=False, mayClearCodeConflict=False,
                  mayAssignNumber=False, mayUploadScene=False)
    a, b = template['descriptors'], photo['descriptors']
    if a is None or b is None or len(b) < 2:
        return dict(**result, reason='no-descriptors')
    pairs = cv.BFMatcher(cv.NORM_L2).knnMatch(a, b, k=2)
    good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < PARAMETERS['ratio']*p[1].distance]
    # One observed feature cannot provide multiple independent correspondences.
    unique = {}
    for match in sorted(good, key=lambda m: m.distance):
        unique.setdefault(match.trainIdx, match)
    good = list(unique.values())
    result['ratioMatches'] = len(good)
    if len(good) < PARAMETERS['minInliers']:
        return dict(**result, reason='insufficient-matches')
    s = np.float32([template['points'][m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    t = np.float32([photo['points'][m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    cv.setRNGSeed(7123)
    matrix, flags = cv.findHomography(s, t, cv.RANSAC, PARAMETERS['ransacPixels'], maxIters=4000)
    if matrix is None or flags is None:
        return dict(**result, reason='no-homography')
    accepted = flags.ravel().astype(bool)
    result['inliers'] = int(accepted.sum())
    if result['inliers'] < PARAMETERS['minInliers'] or accepted.mean() < PARAMETERS['minInlierRatio']:
        return dict(**result, reason='insufficient-inliers')
    geometry = geometry_evidence(matrix, s[accepted], t[accepted], template['shape'], photo['shape'])
    result.update(candidate=geometry['accepted'], geometry=geometry, reason=geometry['reason'])
    return result
