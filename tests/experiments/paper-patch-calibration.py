"""Training-only regularization selection; not a production recognition gate.

The fixed grid is selected by whole-date-out, photo/class-balanced squared
error. Selection loss is not independent acceptance: the winning model needs
a separate held-out evaluation. Patch and region thresholds are unchanged.
"""
import importlib.util
from pathlib import Path
from datetime import date
import re
import numpy as np

spec=importlib.util.spec_from_file_location('patch_probe',Path(__file__).with_name('paper-patch-supervision.py'))
probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)
RIDGES=(.1,.01,.001,.0001)

def balanced_loss(rows):
    losses={0:[],1:[]}
    for row in rows:
        y,s=np.asarray(row['labels']),np.asarray(row['scores'],dtype=np.float64)
        if y.ndim!=1 or s.shape!=y.shape or not np.isfinite(s).all() or not np.isin(y,[-1,0,1]).all():
            raise ValueError('Finite paired observations required')
        for label in (0,1):
            mask=y==label
            if mask.any(): losses[label].append(float(np.mean((s[mask]-label)**2)))
    if any(not values for values in losses.values()): raise ValueError('Both classes required')
    return float(np.mean([np.mean(values) for values in losses.values()]))

def calibrate(records, *, forbidden_dates=(), progress=None):
    rows=sorted(records,key=lambda r:(r['date'],r['sha256']))
    seen=set()
    for row in rows:
        if not isinstance(row['date'],str) or date.fromisoformat(row['date']).isoformat()!=row['date']:
            raise ValueError('Explicit ISO date required')
        if not re.fullmatch('[0-9a-f]{64}',row['sha256']) or row['sha256'] in seen:
            raise ValueError('Unique image identity required')
        seen.add(row['sha256'])
    dates=sorted({r['date'] for r in rows})
    if len(dates)<2 or set(dates)&set(forbidden_dates): raise ValueError('Date isolation failed')
    evaluations=[];completed=0
    for ridge in RIDGES:
        held=[]
        for excluded in dates:
            w=probe.fit_patch_probe([r for r in rows if r['date']!=excluded],ridge=ridge)
            for r in rows:
                if r['date']==excluded:
                    held.append({'labels':r['labels'], 'scores':r['features']@w[:-1]+w[-1]})
            completed+=1
            if progress: progress(completed,len(dates)*len(RIDGES))
        evaluations.append({'ridge':ridge,'balancedSelectionLoss':balanced_loss(held)})
    chosen=min(evaluations,key=lambda x:(x['balancedSelectionLoss'],-x['ridge']))
    return {'ridge':chosen['ridge'],'weights':probe.fit_patch_probe(rows,ridge=chosen['ridge']),
            'selectionDates':len(dates),'selectionImages':len(rows),'grid':evaluations,
            'independentAcceptance':False,'mayAuthorizeUpload':False,'mayClearCodeConflict':False}
