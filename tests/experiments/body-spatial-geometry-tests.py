import importlib.util
from pathlib import Path
import unittest
import numpy as np
import cv2 as cv

spec=importlib.util.spec_from_file_location('geometry',Path(__file__).with_name('body-spatial-geometry.py'))
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)


def fixture():
    s=np.float64([[.1,.2],[.4,.2],[.8,.2],[.1,.4],[.6,.45],[.85,.7],[.2,.8],[.55,.8],[.85,.9]])
    matrix=np.float64([[.6,.025,.1],[-.018,.5,.18],[.04,.08,1]])
    t=cv.perspectiveTransform(s.reshape(-1,1,2),matrix).reshape(-1,2)
    return [dict(pdfPoint=a.tolist(),photoPoint=b.tolist()) for a,b in zip(s,t)]


class GeometryTests(unittest.TestCase):
    def test_distributed_projective_fit_is_only_local_evidence(self):
        r=g.assess(fixture());self.assertTrue(r['observed'])
        for field in ('wholePageVerified','orderBindingVerified','mayAssign','mayClearCodeConflict'):self.assertFalse(r[field])
    def test_single_contrary_position_not_removed_as_outlier(self):
        p=fixture();p[3]['photoPoint']=[.9,.9];self.assertFalse(g.assess(p)['observed'])
    def test_reordered_fields_not_equivalent(self):
        p=fixture();p[1]['photoPoint'],p[5]['photoPoint']=p[5]['photoPoint'],p[1]['photoPoint'];self.assertFalse(g.assess(p)['observed'])
    def test_collinear_and_cluster_not_complete_support(self):
        p=fixture()
        for i,r in enumerate(p):r['pdfPoint']=[.1+i*.02,.4]
        self.assertFalse(g.assess(p)['observed'])
        p=fixture()
        for r in p:r['pdfPoint']=[v*.1 for v in r['pdfPoint']]
        self.assertFalse(g.assess(p)['observed'])
    def test_mirror_and_duplicate_rejected(self):
        p=fixture()
        for r in p:r['photoPoint'][0]=1-r['photoPoint'][0]
        self.assertFalse(g.assess(p)['observed'])
        p=fixture();p[1]=p[0];self.assertFalse(g.assess(p)['observed'])
    def test_input_failure_and_too_few(self):
        self.assertFalse(g.assess(fixture()[:7])['observed'])
        p=fixture();p[0]['photoPoint'][0]=float('nan')
        with self.assertRaises(ValueError):g.assess(p)

if __name__=='__main__':unittest.main()
