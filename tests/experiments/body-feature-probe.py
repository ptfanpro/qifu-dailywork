"""Read-only local experiment: match page BODY features, not printed numbers.

Uses OpenCV SIFT + homography (official OpenCV 4.13 tutorial). This is not an
automatic business-binding rule. Output contains only counts and file hashes.
Install the pinned headless package in an isolated TEMP target, never the app.
"""
import hashlib
import json
import sys
import time

import cv2 as cv
import numpy as np


def load(file):
    data = np.fromfile(file, dtype=np.uint8)
    pixels = cv.imdecode(data, cv.IMREAD_GRAYSCALE)
    if pixels is None:
        raise ValueError("Image could not be decoded")
    scale = min(1, 1800 / max(pixels.shape))
    pixels = cv.resize(pixels, None, fx=scale, fy=scale)
    return pixels, hashlib.sha256(data.tobytes()).hexdigest()


def colored_paper_quads(file, size):
    image = cv.imdecode(np.fromfile(file, dtype=np.uint8), cv.IMREAD_COLOR)
    image = cv.resize(image, (size[1], size[0]))
    hsv = cv.cvtColor(image, cv.COLOR_BGR2HSV)
    h, s, v = cv.split(hsv)
    regions = (((h < 13) | (h > 170)) & (s > 75) & (v > 35),
               (h > 15) & (h < 40) & (s > 65) & (v > 45))
    candidates = []
    for selected in regions:
        binary = cv.morphologyEx(selected.astype(np.uint8)*255, cv.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        contours, _ = cv.findContours(binary, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = cv.contourArea(contour)
            if area < image.shape[0]*image.shape[1]*.02:
                continue
            polygon = cv.approxPolyDP(contour, .02*cv.arcLength(contour, True), True)
            if len(polygon) != 4 or not cv.isContourConvex(polygon):
                continue
            points = polygon.reshape(4, 2).astype(np.float32)
            sums = points.sum(axis=1)
            differences = np.diff(points, axis=1).ravel()
            quad = np.array([points[sums.argmin()], points[differences.argmin()], points[sums.argmax()], points[differences.argmax()]])
            if len({tuple(p) for p in quad}) == 4:
                candidates.append((area, quad))
    return [quad for _, quad in sorted(candidates, key=lambda value: -value[0])[:3]]


def ink_similarity(page, aligned, region):
    observed = cv.adaptiveThreshold(aligned, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 9) > 0
    expected = (page < 190) & region
    observed &= region
    to_observed = cv.distanceTransform((~observed).astype(np.uint8), cv.DIST_L2, 3)
    to_expected = cv.distanceTransform((~expected).astype(np.uint8), cv.DIST_L2, 3)
    recall = float(np.mean(to_observed[expected] <= 2)) if expected.any() else 0
    precision = float(np.mean(to_expected[observed] <= 2)) if observed.any() else 0
    return round(2*recall*precision/max(.0001, recall+precision), 4)


def measure(photo_file, page_files):
    started = time.monotonic()
    cv.setNumThreads(2)
    cv.setRNGSeed(7123)
    detector = cv.SIFT_create(nfeatures=6000, contrastThreshold=.02)
    photo, photo_sha = load(photo_file)
    quads = colored_paper_quads(photo_file, photo.shape)
    photo = cv.createCLAHE(clipLimit=2, tileGridSize=(8, 8)).apply(photo)
    photo_points, photo_descriptors = detector.detectAndCompute(photo, None)
    matcher = cv.FlannBasedMatcher(dict(algorithm=1, trees=5), dict(checks=80))
    loaded_pages = [load(file) for file in page_files]
    differing = None
    if len({pixels.shape for pixels, _ in loaded_pages}) == 1:
        ink_stack = np.stack([pixels < 190 for pixels, _ in loaded_pages])
        differing = cv.dilate((np.var(ink_stack.astype(np.float32), axis=0) > .05).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    rows = []
    for page, page_sha in loaded_pages:
        h, w = page.shape
        mask = np.zeros_like(page)
        # Exclude shared decorative frame, title, printed code and lower seal.
        # This mask is for the tested landscape template, not all templates.
        mask[int(h*.17):int(h*.72), int(w*.07):int(w*.94)] = 255
        mask[int(h*.65):, int(w*.57):int(w*.78)] = 0
        points, descriptors = detector.detectAndCompute(page, mask)
        good, inliers = [], []
        matrix = None
        if descriptors is not None and photo_descriptors is not None and len(photo_descriptors) >= 2:
            pairs = matcher.knnMatch(descriptors, photo_descriptors, k=2)
            good = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < .65*pair[1].distance]
            if len(good) >= 8:
                source = np.float32([points[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
                target = np.float32([photo_points[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
                matrix, accepted = cv.findHomography(source, target, cv.RANSAC, 4, maxIters=4000)
                if accepted is not None:
                    inliers = [m for m, ok in zip(good, accepted.ravel()) if ok]
        occupied = {(min(3, int(points[m.queryIdx].pt[0]*4/w)), min(3, int(points[m.queryIdx].pt[1]*4/h))) for m in inliers}
        ink_score = None
        region = mask > 0
        if differing is not None:
            region &= differing
        if matrix is not None and abs(np.linalg.det(matrix)) > 1e-10:
            aligned = cv.warpPerspective(photo, np.linalg.inv(matrix), (w, h), borderValue=255)
            ink_score = ink_similarity(page, aligned, region)
        quad_scores = []
        for quad in quads:
            transform = cv.getPerspectiveTransform(quad, np.float32([[0, 0], [w-1, 0], [w-1, h-1], [0, h-1]]))
            aligned = cv.warpPerspective(photo, transform, (w, h), borderValue=255)
            quad_scores.append(ink_similarity(page, aligned, region))
        rows.append(dict(pageSha256=page_sha, features=len(points), ratioMatches=len(good),
                         inliers=len(inliers), occupiedGridCells=len(occupied),
                         inlierRatio=round(len(inliers)/max(1, len(good)), 4),
                         discriminatingInkF1=ink_score,
                         colorQuadInkF1=quad_scores,
                         homographyFound=matrix is not None))
    return dict(status="EXPERIMENT_NOT_BINDING_PROOF", opencv=cv.__version__, photoSha256=photo_sha,
                seconds=round(time.monotonic()-started, 3), pages=rows)


if __name__ == "__main__":
    if len(sys.argv) < 4:
        raise SystemExit("PHOTO PAGE_PNG PAGE_PNG [PAGE_PNG ...]")
    print(json.dumps(measure(sys.argv[1], sys.argv[2:])))
