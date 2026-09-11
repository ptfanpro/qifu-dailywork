"""Offline composite-field hypothesis, not an assignment or upload authority.

Printed decoration supplies geometry only. Require whole, paired OCR fields
inside its observed support and at corresponding positions; common decoration
or a shared name alone is not a unique composite in the full PDF corpus.
"""
import hashlib
import re
import unicodedata
import numpy as np
import cv2 as cv


def normalize(text):
    if not isinstance(text, str) or any(unicodedata.category(c).startswith('C') or c in '\r\n\u2028\u2029' for c in text):
        return None
    return ''.join(unicodedata.normalize('NFKC', text).split())


def term(text):
    value = normalize(text)
    return value if value and 3 <= len(value) <= 40 and all('\u4e00' <= c <= '\u9fff' for c in value) else None


NAMES = ['chinese-detected-0.35', 'chinese-detected-0.65', 'chinese-vertical-0.35', 'chinese-vertical-0.65']


def paired_fields(views):
    if len(views) != 4 or sorted(v['view'] for v in views) != sorted(NAMES):
        raise ValueError('Incomplete positioned views')
    ordered = [next(v for v in views if v['view'] == name) for name in NAMES]
    dimensions = None
    for v in ordered:
        p = v['positioned']
        if v['errors'] != 0 or v['truncated'] is not False or p['schemaVersion'] != 1:
            raise ValueError('Failed or truncated positioned views')
        d = p['dimensions']
        if any(type(d[k]) is not int or d[k] <= 0 for k in ['width', 'height']):
            raise ValueError('Invalid dimensions')
        if dimensions is not None and dimensions != d:
            raise ValueError('Changed dimensions')
        dimensions = d
        fields = p['fields']
        if v['text'] != '。'.join(f['text'] for f in fields) or v['lineCount'] != len(fields):
            raise ValueError('Position/text mismatch')
        if len(set(f['regionIndex'] for f in fields)) != len(fields):
            raise ValueError('Repeated region index')
        for f in fields:
            r = f['region']
            if type(f['regionIndex']) is not int or f['regionIndex'] < 0 or not .65 <= f['confidence'] <= 1:
                raise ValueError('Invalid field observation')
            if any(not np.isfinite(r[k]) or r[k] < 0 for k in ['left', 'top', 'width', 'height']):
                raise ValueError('Invalid field box')
            if min(r['width'], r['height']) <= 0 or r['left']+r['width'] > 1 or r['top']+r['height'] > 1:
                raise ValueError('Outside field box')
    result = []
    for offset in [0, 2]:
        a, b = ordered[offset:offset+2]
        for f in a['positioned']['fields']:
            value = term(f['text'])
            if not value:
                continue
            matches = [s for s in b['positioned']['fields'] if s['regionIndex'] == f['regionIndex']
                       and s['region'] == f['region'] and term(s['text']) == value]
            # Repeated occurrences cannot be merged or selected by proximity.
            unique = all(sum(normalize(s['text']) == value for s in v['positioned']['fields']) == 1 for v in [a, b])
            if len(matches) == 1 and unique:
                result.append(dict(text=value, region=f['region'], regionIndex=f['regionIndex'], dimensions=dimensions))
    return result


def rectangle(field):
    r, d = field['region'], field['dimensions']
    x, y, w, h = r['left'], r['top'], r['width'], r['height']
    return np.float32([[x, y], [x+w, y], [x+w, y+h], [x, y+h]])*np.float32([d['width'], d['height']])


def positioned_pairs(page_views, photo_views, layout):
    source, target = paired_fields(page_views), paired_fields(photo_views)
    if layout.get('candidate') is not True or layout.get('localSupport', {}).get('observed') is not True:
        return []
    support = layout['localSupport']
    matrix = np.float64(support['matrix'])
    hull, projected_hull = np.float32(support['sourceHull']), np.float32(support['projectedHull'])
    if matrix.shape != (3, 3) or not np.isfinite(matrix).all() or not np.isfinite(hull).all() or not np.isfinite(projected_hull).all():
        raise ValueError('Invalid geometry')
    if not cv.isContourConvex(hull) or not cv.isContourConvex(projected_hull) or cv.contourArea(hull) <= 0:
        raise ValueError('Invalid support hull')
    pairs = []
    for field in source:
        matches = [f for f in target if f['text'] == field['text']]
        if len(matches) != 1:
            continue
        a, b = rectangle(field), rectangle(matches[0])
        if not all(cv.pointPolygonTest(hull, tuple(map(float, v)), False) >= 0 for v in a):
            continue
        if not all(cv.pointPolygonTest(projected_hull, tuple(map(float, v)), False) >= 0 for v in b):
            continue
        denominator = np.column_stack([a, np.ones(4)]) @ matrix[2]
        if np.min(np.abs(denominator)) < 1e-8 or not (np.all(denominator > 0) or np.all(denominator < 0)):
            continue
        projected = cv.perspectiveTransform(a.reshape(-1, 1, 2), matrix).reshape(-1, 2)
        if not np.isfinite(projected).all() or not cv.isContourConvex(projected) or cv.contourArea(projected, oriented=True) <= 0:
            continue
        overlap = float(cv.intersectConvexConvex(projected, b)[0])
        union = cv.contourArea(projected)+cv.contourArea(b)-overlap
        # A fixed diagnostic majority-overlap criterion, NOT production-calibrated.
        if union <= 0 or overlap/union < .5:
            continue
        pairs.append(dict(text=field['text'], fieldSha256=hashlib.sha256(field['text'].encode()).hexdigest(),
                          regionIndex=matches[0]['regionIndex'], iou=overlap/union))
    return pairs


def compare_positioned_fields(pages, photo_views, layouts):
    if any(not re.fullmatch('[a-f0-9]{64}',p.get('pdfSha256','')) or type(p.get('pageNumber')) is not int or p['pageNumber'] < 1 for p in pages):
        raise ValueError('Invalid physical page')
    identities = [(p['pdfSha256'], p['pageNumber']) for p in pages]
    if not identities or len(set(identities)) != len(identities) or len(layouts) != len(pages):
        raise ValueError('Incomplete physical corpus')
    for p in pages:
        paired_fields(p['views'])  # Reject incomplete reads even on a non-leading page.
    paired_fields(photo_views)
    # A multiline field must not hide the rest of a page from ambiguity
    # checks, nor may separate lines be joined into a new matching field.
    corpus = [[normalize(line) or '' for t in p['fieldTexts']+
               [f['text'] for v in p['views'] for f in v['positioned']['fields']]
               for line in t.splitlines()] for p in pages]
    rows = []
    for i, page in enumerate(pages):
        pairs = positioned_pairs(page['views'], photo_views, layouts[i])
        terms = set(f['text'] for f in pairs)
        containing = [j for j, fields in enumerate(corpus) if all(any(t in field for field in fields) for t in terms)] if terms else []
        unique = len(terms) >= 2 and containing == [i]
        rows.append(dict(pdfSha256=page['pdfSha256'], pageNumber=page['pageNumber'], uniqueComposite=unique,
                         fields=[{k: v for k, v in f.items() if k != 'text'} for f in pairs]))
    return dict(status='positioned-composite-observation-not-binding', rows=rows,
                candidates=sum(r['uniqueComposite'] for r in rows), mayAssign=False, mayClearCodeConflict=False)
