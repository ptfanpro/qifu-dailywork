import unittest
from pathlib import Path
from importlib.util import spec_from_file_location, module_from_spec
import numpy as np
spec=spec_from_file_location('role_kernel',Path(__file__).with_name('role-kernel.py'))
m=module_from_spec(spec);spec.loader.exec_module(m)

def row(role, vector, identity, date='train'):
    a=np.zeros(512);a[:len(vector)]=vector
    return {'role':role,'reviewed':True,'date':date,'sha256':identity,
            'views':[{'view':v,'embedding':a.tolist()} for v in m.VIEWS]}

def training():
    return [row('paper',[1,1,0,0],'a'),row('paper',[-1,-1,0,0],'b'),
            row('lamp',[1,-1,0,0],'c'),row('lamp',[-1,1,0,0],'d'),
            row('water',[0,0,1,0],'e'),row('mixed-scene',[0,0,0,1],'f')]

class KernelTests(unittest.TestCase):
    def test_interacting_features_separate_without_relaxing_margin(self):
        model=m.fit(training())
        for r in training():
            query={**r,'sha256':'new-'+r['sha256'],'date':'evaluation'}
            result=m.predict(model,query)
            self.assertEqual(result['candidate'],None if r['role']=='mixed-scene' else r['role'])
            self.assertFalse(result['bindingVerified'] or result['mayAuthorizeUpload'] or result['mayClearCodeConflict'])
        self.assertEqual(m.MIN_GAP,.15);self.assertEqual(m.RIDGE,.1)

    def test_kernel_equals_explicit_quadratic_feature_inner_product(self):
        x=np.array([[.6,.8],[-.8,.6]])
        phi=np.stack([np.ones(2),np.sqrt(2)*x[:,0],np.sqrt(2)*x[:,1],x[:,0]**2,
                      np.sqrt(2)*x[:,0]*x[:,1],x[:,1]**2],axis=1)
        np.testing.assert_allclose(m.kernel(x,x),phi@phi.T,atol=1e-14)

    def test_no_query_answers_or_filename_features(self):
        model=m.fit(training());r=row('paper',[1,1],'g','evaluation')
        result=m.predict(model,r)
        self.assertEqual(result,m.predict(model,{**r,'role':'water','file':'2.5.jpg','expected':'water'}))

    def test_date_and_content_leakage_rejected(self):
        model=m.fit(training())
        for r in [row('paper',[1,1],'new'),row('paper',[1,1],'a','evaluation')]:
            with self.assertRaises(ValueError):m.predict(model,r)

    def test_view_disagreement_and_missing_inputs_not_accepted(self):
        model=m.fit(training());r=row('paper',[1,1],'new','evaluation')
        r['views'][1]=row('water',[0,0,1],'water')['views'][1]
        self.assertIsNone(m.predict(model,r)['candidate'])
        r['views'].pop()
        with self.assertRaises(ValueError):m.predict(model,r)
        with self.assertRaises(ValueError):m.fit(training()[:-1])
        r=training();r[0]['reviewed']=False
        with self.assertRaises(ValueError):m.fit(r)

    def test_fit_snapshot_not_mutated_by_caller(self):
        rows=training();model=m.fit(rows);query=row('paper',[1,1],'new','evaluation')
        before=m.predict(model,query);rows[0]['views'][0]['embedding'][0]=1000
        self.assertEqual(before,m.predict(model,query))

if __name__=='__main__':unittest.main()
