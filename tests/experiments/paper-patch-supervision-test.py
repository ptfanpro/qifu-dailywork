import unittest
import importlib.util
from pathlib import Path
import numpy as np

spec = importlib.util.spec_from_file_location('patches', Path(__file__).with_name('paper-patch-supervision.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class GeometryTests(unittest.TestCase):
    def test_full_frame_and_crop_use_oriented_original_space(self):
        full = m.patch_boxes(1801, 1350, 'full-frame')
        crop = m.patch_boxes(1801, 1350, 'center-crop')
        self.assertEqual(full.shape, (196, 4))
        np.testing.assert_allclose(full[0], [0, 0, 1/14, 1/14])
        np.testing.assert_allclose(crop[0], [225/1801, 0, (225+1350/14)/1801, 1/14])
        self.assertAlmostEqual(crop[-1, 2], 1575/1801)
        for w,h,v in [(0,100,'full-frame'),(True,100,'full-frame'),(12.5,100,'full-frame'),(100,100,'other')]:
            with self.assertRaises(ValueError): m.patch_boxes(w,h,v)

    def test_only_wholly_interior_or_wholly_exterior_cells_are_supervised(self):
        boxes = np.array([[.3,.3,.4,.4],[.19,.3,.3,.4],[0,0,.1,.1],[.1,.1,.3,.3]])
        labels = m.training_mask(boxes, [.25,.25,.75,.75], [.2,.2,.8,.8])
        np.testing.assert_array_equal(labels, [1,-1,0,-1])
        np.testing.assert_array_equal(m.training_mask(boxes,None,None), [0,0,0,0])
        with self.assertRaises(ValueError): m.training_mask(boxes, [.1,.1,.9,.9], [.2,.2,.8,.8])
        with self.assertRaises(ValueError): m.training_mask(boxes,None,[.2,.2,.8,.8])

    def test_patch_features_are_finite_and_unit_not_global_image_vectors(self):
        x = np.ones((2,196,768), dtype=np.float32)
        out = m.unit_patches(x)
        np.testing.assert_allclose(np.linalg.norm(out,axis=-1),1)
        for bad in [np.zeros_like(x),np.ones((2,768)),x*np.nan]:
            with self.assertRaises(ValueError): m.unit_patches(bad)

    def test_connected_region_does_not_merge_diagonal_or_scattered_detections(self):
        s = np.zeros((14,14)); np.fill_diagonal(s,.9)
        self.assertFalse(m.paper_region_candidate(s.ravel())['paperCandidate'])
        s[3:6,4:8] = .9
        r=m.paper_region_candidate(s.ravel())
        self.assertTrue(r['paperCandidate'])
        self.assertFalse(r['bindingVerified']); self.assertFalse(r['mayAuthorizeUpload'])
        self.assertFalse(r['mayClearCodeConflict'])
        with self.assertRaises(ValueError): m.paper_region_candidate([1]*195)

    def test_training_excludes_uncertain_cells_and_is_order_invariant(self):
        x=np.array([[1.,0],[0,1],[.9,.1],[.1,.9]])
        records=[{'features':x,'labels':np.array([1,0,1,-1])},
                 {'features':x[::-1],'labels':np.array([0,1,0,1])}]
        a=m.fit_patch_probe(records)
        b=m.fit_patch_probe(records[::-1])
        np.testing.assert_allclose(a,b,atol=1e-12)
        self.assertGreater(np.r_[x[0],1]@a, np.r_[x[1],1]@a)
        with self.assertRaises(ValueError): m.fit_patch_probe([{'features':x,'labels':np.zeros(4)}])

if __name__=='__main__': unittest.main()
