"""Synthetic routing contracts; not real scene or number acceptance."""
import unittest, copy, importlib.util
from pathlib import Path
import numpy as np

def module(name, file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

m=module('layout_routing','role-layout-routing.py')
old=module('original_two_stage','role-two-stage.py')

def row(role, identity, date='training'):
    a=np.zeros(512);a[{'paper':0,'lamp':1,'water':2,'mixed-scene':3}[role]]=1
    b=np.zeros(1024);b[:512]=a;b[512 if role=='paper' else 513]=1
    return {'role':role,'reviewed':True,'sha256':identity,'date':date,
            'views':[{'view':v,'embedding':a.tolist()} for v in old.VIEWS],
            'paperViews':[{'view':v,'embedding':b.tolist()} for v in old.VIEWS]}

class LayoutRoutingTests(unittest.TestCase):
    def setUp(self):
        self.rows=[row(r,str(i)) for i,r in enumerate(old.ROLES)]

    def test_layout_never_enters_scene_category_training(self):
        reference=old.fit(self.rows);current=m.fit(self.rows)
        for a,b in zip(reference['categoryModels'],current['categoryModels']):
            for x,y in zip(a,b):np.testing.assert_array_equal(x,y)
        changed=copy.deepcopy(self.rows)
        for r in changed:
            for v in r['paperViews']:v['embedding']=np.roll(v['embedding'],30).tolist()
        other=m.fit(changed)
        for a,b in zip(current['categoryModels'],other['categoryModels']):
            for x,y in zip(a,b):np.testing.assert_array_equal(x,y)

    def test_paper_signal_routes_without_scene_score_or_upload_authority(self):
        model=m.fit(self.rows)
        for role in ('paper','lamp','water'):
            p=m.predict(model,row(role,'eval-'+role,'evaluation'))
            self.assertEqual(p['candidate'],role)
            self.assertFalse(p['mayAuthorizeUpload'] or p['mayClearCodeConflict'] or p['bindingVerified'])
        r=row('paper','different','evaluation');before=m.predict(model,r)
        r['views']=row('water','unused')['views']
        after=m.predict(model,r)
        self.assertEqual(before['candidate'],after['candidate'])
        self.assertEqual([v['paperScore'] for v in before['views']],[v['paperScore'] for v in after['views']])

    def test_layout_is_mandatory_and_holdout_identity_not_bypassed(self):
        model=m.fit(self.rows)
        with self.assertRaises(ValueError):m.predict(model,row('paper','different','training'))
        for key,value in [('paperViews',[]),('paperViews',[{'view':v,'embedding':[1]} for v in old.VIEWS]),
                          ('paperViews',[{'view':v,'embedding':[float('nan')]*1024} for v in old.VIEWS])]:
            r=row('paper','evaluation','evaluation');r[key]=value
            with self.assertRaises(ValueError):m.predict(model,r)
        r=row('paper','evaluation','evaluation');del r['paperViews']
        with self.assertRaises(ValueError):m.predict(model,r)

if __name__=='__main__':unittest.main()
