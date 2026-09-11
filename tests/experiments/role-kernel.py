"""Fixed quadratic-feature role experiment, not a product/upload decision.

Uses the same reviewed labels, normalized CLIP views, class weights, ridge
and acceptance margin as the earlier linear probe. Only the representation
changes: pairwise feature interactions can represent foreground/context
combinations that a linear boundary cannot. No evaluation-driven tuning.
"""
import numpy as np

ROLES=('paper','lamp','water','mixed-scene')
VIEWS=('center-crop','full-frame')
RIDGE=.1
MIN_GAP=.15
RECIPE='weighted-centered-quadratic-kernel-ridge-v1'

def normalized_views(row):
    views=row.get('views',[])
    if len(views)!=2 or set(v.get('view') for v in views)!=set(VIEWS):
        raise ValueError('Incomplete feature views')
    values=[]
    for name in VIEWS:
        a=np.asarray(next(v['embedding'] for v in views if v['view']==name),dtype=np.float64)
        if a.shape!=(512,) or not np.isfinite(a).all() or np.linalg.norm(a)<1e-8:
            raise ValueError('Invalid frozen embedding')
        values.append(a/np.linalg.norm(a))
    return values

def kernel(x,y):
    return (1+x@y.T)**2

def fit(rows):
    if len(rows)<4 or any(r.get('reviewed') is not True or r.get('role') not in ROLES for r in rows):
        raise ValueError('Reviewed training roles required')
    ids=[r['sha256'] for r in rows]
    if len(set(ids))!=len(ids) or any(not r.get('date') for r in rows) or set(r['role'] for r in rows)!=set(ROLES):
        raise ValueError('Unique identities and all four roles required')
    arrays=[normalized_views(r) for r in rows]
    w=np.array([len(rows)/(4*sum(s['role']==r['role'] for s in rows)) for r in rows])
    p=w/w.sum();sqrtw=np.sqrt(w)
    target=np.array([[float(r['role']==role) for role in ROLES] for r in rows]);mean_y=p@target
    models=[]
    for view in range(2):
        x=np.array([a[view] for a in arrays]);k=kernel(x,x);column_mean=p@k;grand=float(p@k@p)
        centered=k-(k@p)[:,None]-column_mean[None,:]+grand
        a=centered*sqrtw[:,None]*sqrtw[None,:]
        dual=np.linalg.solve(a+RIDGE*np.eye(len(rows)),(target-mean_y)*sqrtw[:,None])
        models.append({'x':x,'p':p.copy(),'columnMean':column_mean,'grand':grand,
                       'meanY':mean_y.copy(),'coefficients':dual*sqrtw[:,None]})
    return {'recipe':RECIPE,'models':models,'trainingDates':set(r['date'] for r in rows),'trainingHashes':set(ids)}

def predict(model,row,enforce_holdout=True):
    if enforce_holdout and (row['date'] in model['trainingDates'] or row['sha256'] in model['trainingHashes']):
        raise ValueError('Training/evaluation identity leakage')
    results=[]
    for a,head in zip(normalized_views(row),model['models']):
        k=kernel(a[None,:],head['x'])[0]
        scores=(k-k@head['p']-head['columnMean']+head['grand'])@head['coefficients']+head['meanY']
        if not np.isfinite(scores).all():raise ValueError('Invalid classifier score')
        order=np.argsort(-scores,kind='stable')
        results.append({'role':ROLES[order[0]],'gap':float(scores[order[0]]-scores[order[1]]),
                        'scores':[float(s) for s in scores]})
    candidate=results[0]['role'] if results[0]['role']==results[1]['role'] and all(r['gap']>=MIN_GAP for r in results) else None
    if candidate=='mixed-scene':candidate=None
    return {'candidate':candidate,'views':results,'bindingVerified':False,
            'mayAuthorizeUpload':False,'mayClearCodeConflict':False}
