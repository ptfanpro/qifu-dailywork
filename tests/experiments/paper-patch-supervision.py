"""Offline regional probe. No OCR answers, filenames, dates or production use.

Manual rectangles supervise training only. Prediction receives patch features
only; finding a region does not establish a readable number or order binding.
Fixed first-study recipe: ridge .1, patch score .75, connected area 12/196.
These exploratory bounds must not be selected using held-out outcomes.
"""
import numpy as np


def patch_boxes(width, height, view):
    if any(type(v) is not int or v < 1 for v in (width, height)):
        raise ValueError('Positive EXIF-oriented integer dimensions required')
    if view not in ('center-crop', 'full-frame'):
        raise ValueError('Explicit frozen view required')
    left = top = 0
    cw, ch = width, height
    if view == 'center-crop':
        cw = ch = min(width, height)
        left, top = (width-cw)//2, (height-ch)//2
    return np.array([[(left+x*cw/14)/width, (top+y*ch/14)/height,
                      (left+(x+1)*cw/14)/width, (top+(y+1)*ch/14)/height]
                     for y in range(14) for x in range(14)], dtype=np.float64)


def _rect(value):
    a = np.asarray(value, dtype=np.float64)
    if a.shape != (4,) or not np.isfinite(a).all() or np.any(a < 0) or np.any(a > 1):
        raise ValueError('Invalid normalized rectangle')
    if a[0] >= a[2] or a[1] >= a[3]:
        raise ValueError('Empty rectangle')
    return a


def training_mask(boxes, inner, outer):
    boxes = np.asarray(boxes, dtype=np.float64)
    if boxes.ndim != 2 or boxes.shape[1] != 4:
        raise ValueError('Patch boxes required')
    for b in boxes: _rect(b)
    if inner is None and outer is None:
        return np.zeros(len(boxes), dtype=np.int8)
    if inner is None or outer is None:
        raise ValueError('Both inner and outer annotations required')
    i, o = _rect(inner), _rect(outer)
    if i[0]<o[0] or i[1]<o[1] or i[2]>o[2] or i[3]>o[3]:
        raise ValueError('Interior escapes exclusion envelope')
    result = np.full(len(boxes), -1, dtype=np.int8)
    outside = (boxes[:,2]<=o[0])|(boxes[:,0]>=o[2])|(boxes[:,3]<=o[1])|(boxes[:,1]>=o[3])
    inside = (boxes[:,0]>=i[0])&(boxes[:,1]>=i[1])&(boxes[:,2]<=i[2])&(boxes[:,3]<=i[3])
    result[outside], result[inside] = 0, 1
    return result


def unit_patches(values):
    a = np.asarray(values, dtype=np.float64)
    if a.shape != (2,196,768) or not np.isfinite(a).all():
        raise ValueError('Two finite 14x14 patch grids required')
    norms = np.linalg.norm(a,axis=-1,keepdims=True)
    if np.any(norms < 1e-10): raise ValueError('Empty patch feature')
    return a/norms


def fit_patch_probe(records):
    xs, ys, ws = [], [], []
    for record in records:
        x, y = np.asarray(record['features'],dtype=np.float64), np.asarray(record['labels'])
        if x.ndim != 2 or y.shape != (len(x),) or not np.isfinite(x).all() or not np.isin(y,[-1,0,1]).all():
            raise ValueError('Invalid training observations')
        keep=y>=0; x,y=x[keep],y[keep]
        if not len(y): continue
        # Each photo contributes equally within each class, irrespective of
        # its paper size or number of background patches. Then balance classes.
        w=np.zeros(len(y))
        for label in (0,1):
            subset=y==label
            if subset.any(): w[subset]=1/subset.sum()
        xs.append(x); ys.append(y); ws.append(w)
    if not xs: raise ValueError('No supervised cells')
    x,y,w=np.concatenate(xs),np.concatenate(ys),np.concatenate(ws)
    for label in (0,1):
        subset=y==label
        if not subset.any(): raise ValueError('Both classes required')
        w[subset]/=w[subset].sum()
    x=np.column_stack((x,np.ones(len(x))))
    penalty=np.eye(x.shape[1])*.1; penalty[-1,-1]=0
    return np.linalg.solve(x.T@(w[:,None]*x)+penalty,x.T@(w*y))


def paper_region_candidate(scores):
    a=np.asarray(scores,dtype=np.float64)
    if a.shape!=(196,) or not np.isfinite(a).all(): raise ValueError('Finite patch scores required')
    active=(a.reshape(14,14)>=.75)
    seen=set(); components=[]
    for y,x in np.argwhere(active):
        if (y,x) in seen: continue
        todo=[(int(y),int(x))]; seen.add((y,x)); component=[]
        while todo:
            cy,cx=todo.pop(); component.append((cy,cx))
            for ny,nx in [(cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)]:
                if 0<=ny<14 and 0<=nx<14 and active[ny,nx] and (ny,nx) not in seen:
                    seen.add((ny,nx)); todo.append((ny,nx))
        components.append(component)
    largest=max(components,key=len,default=[])
    return {'paperCandidate':len(largest)>=12,'largestComponent':len(largest),
            'cells':largest,'bindingVerified':False,'mayAuthorizeUpload':False,
            'mayClearCodeConflict':False}
