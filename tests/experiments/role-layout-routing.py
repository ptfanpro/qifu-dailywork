"""Diagnostic routing: geometry reaches the paper head, never lamp/water.

Uses the unchanged binary-head fitting and decision margins from the existing
two-stage experiment. It is not a production classifier, probability estimate,
mixed-scene detector, printed-number decision or permission to upload.
"""
import importlib.util
from pathlib import Path
import numpy as np

_spec=importlib.util.spec_from_file_location('frozen_two_stage',Path(__file__).with_name('role-two-stage.py'))
_base=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_base)

def paper_views(row):
    views=row.get('paperViews',[])
    if len(views)!=2 or {v.get('view') for v in views}!=set(_base.VIEWS):
        raise ValueError('Both explicit paper feature views required')
    out=[]
    for name in _base.VIEWS:
        a=np.asarray(next(v['embedding'] for v in views if v['view']==name),dtype=np.float64)
        if a.shape!=(1024,) or not np.isfinite(a).all() or np.linalg.norm(a)<1e-8:
            raise ValueError('Invalid paper feature vector')
        out.append(a/np.linalg.norm(a))
    return out

def fit(rows):
    model=_base.fit(rows)  # preserves all identity, label and base-vector checks
    arrays=np.asarray([paper_views(r) for r in rows])
    model['paperModels']=[_base.fit_head(arrays[:,v,:],[r['role']=='paper' for r in rows]) for v in range(2)]
    model['paperDimensions']=1024
    return model

def predict(model,row,enforce_holdout=True):
    if enforce_holdout and (row['date'] in model['trainingDates'] or row['sha256'] in model['trainingHashes']):
        raise ValueError('Training/evaluation identity leakage')
    geometry=paper_views(row);visual=_base.normalized_views(row);views=[]
    for name,a,b,p,c in zip(_base.VIEWS,geometry,visual,model['paperModels'],model['categoryModels']):
        ps=float((a-p[0])@p[2]+p[1]);cs=float((b-c[0])@c[2]+c[1])
        views.append({'view':name,'paperScore':ps,'lampScore':cs,'paperGap':abs(ps-.5),'categoryGap':abs(cs-.5)})
    candidate,reason=None,'paper-role-uncertain'
    if all(v['paperGap']>=_base.MIN_GAP for v in views):
        if all(v['paperScore']>.5 for v in views):
            candidate,reason='paper','paper-head-consistent'
        elif all(v['paperScore']<.5 for v in views):
            reason='category-uncertain'
            if all(v['categoryGap']>=_base.MIN_GAP for v in views):
                if all(v['lampScore']>.5 for v in views):candidate,reason='lamp','both-heads-consistent'
                elif all(v['lampScore']<.5 for v in views):candidate,reason='water','both-heads-consistent'
    return {'candidate':candidate,'reason':reason,'views':views,'scoreIsProbability':False,
            'bindingVerified':False,'mayAuthorizeUpload':False,'mayClearCodeConflict':False}
