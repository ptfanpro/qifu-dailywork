"""Diagnostic local field alignment; never whole-page or order identity.

Coordinates are normalized by each oriented image's width and height. Fixed
limits precede real-data measurement, not calibrated confidence estimates.
No text, filenames, historical code or desired answer is an input to the fit.
"""
import cv2 as cv
import numpy as np

PARAMETERS = dict(minPoints=8, minSpan=.25, minHull=.04, maxError=.015,
                  ransacError=.01, maxIters=4000)


def assess(pairs):
    result = dict(observed=False, wholePageVerified=False, orderBindingVerified=False,
                  mayAssign=False, mayClearCodeConflict=False, points=len(pairs))
    if len(pairs) < PARAMETERS['minPoints']:
        return dict(**result, reason='too-few-unique-fields')
    s = np.asarray([p['pdfPoint'] for p in pairs], np.float64)
    t = np.asarray([p['photoPoint'] for p in pairs], np.float64)
    if (s.shape != (len(pairs), 2) or t.shape != s.shape or not np.isfinite(s).all()
            or not np.isfinite(t).all() or np.any(s < 0) or np.any(s > 1)
            or np.any(t < 0) or np.any(t > 1)):
        raise ValueError('Invalid normalized points')
    if len(set(map(tuple, s))) != len(s) or len(set(map(tuple, t))) != len(t):
        return dict(**result, reason='duplicate-spatial-support')
    hull = cv.convexHull(s.astype(np.float32)).reshape(-1, 2)
    result.update(sourceSpan=np.ptp(s, axis=0).tolist(), sourceHull=float(cv.contourArea(hull)))
    if min(result['sourceSpan']) < PARAMETERS['minSpan'] or result['sourceHull'] < PARAMETERS['minHull']:
        return dict(**result, reason='local-cluster-or-collinear')
    cv.setRNGSeed(9123)
    matrix, flags = cv.findHomography(s, t, cv.RANSAC, PARAMETERS['ransacError'], maxIters=PARAMETERS['maxIters'])
    if matrix is None or flags is None or not np.isfinite(matrix).all():
        return dict(**result, reason='no-finite-homography')
    result['inliers'] = int(flags.sum())
    # Do not discard contrary exact field positions by selecting only inliers.
    if not np.all(flags):
        return dict(**result, reason='contrary-field-position')
    denominators = np.column_stack([hull, np.ones(len(hull))]) @ matrix[2]
    if (np.min(np.abs(denominators)) < 1e-8 or
            not (np.all(denominators > 0) or np.all(denominators < 0))):
        return dict(**result, reason='projective-pole')
    q = cv.perspectiveTransform(hull.reshape(-1, 1, 2), matrix).reshape(-1, 2)
    if (not np.isfinite(q).all() or not cv.isContourConvex(q)
            or cv.contourArea(q, oriented=True) * cv.contourArea(hull, oriented=True) <= 0):
        return dict(**result, reason='mirror-or-invalid-projection')
    error = np.linalg.norm(cv.perspectiveTransform(s.reshape(-1, 1, 2), matrix).reshape(-1, 2)-t, axis=1)
    result.update(maxError=float(error.max()), medianError=float(np.median(error)))
    if not np.isfinite(error).all() or result['maxError'] > PARAMETERS['maxError']:
        return dict(**result, reason='unstable-field-fit')
    result.update(observed=True, reason='distributed-field-alignment', matrix=matrix.tolist(),
                  supportedSourceHull=hull.tolist(), supportedPhotoHull=q.tolist())
    return result
