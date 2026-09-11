import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import numpy as np

spec=importlib.util.spec_from_file_location('calibration',Path(__file__).with_name('paper-patch-calibration.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def records():
    return [{'date':f'2026-01-{day:02d}','sha256':str(day)*64,
             'features':np.array([[1.,0],[0.,1],[.8,.2],[.2,.8]]),
             'labels':np.array([1,0,1,0])} for day in (1,2,3)]

class CalibrationTests(unittest.TestCase):
    def test_whole_dates_are_excluded_not_just_one_image(self):
        rows=records();rows.append({**rows[0],'sha256':'4'*64})
        seen=[];real=m.probe.fit_patch_probe
        def record_fit(rs,**kw):
            seen.append(tuple(sorted(r['date'] for r in rs)))
            return real(rs,**kw)
        with patch.object(m.probe,'fit_patch_probe',side_effect=record_fit):
            result=m.calibrate(rows)
        self.assertEqual(len(seen),3*4+1)
        self.assertTrue(all(s.count('2026-01-01') in (0,2) for s in seen))
        self.assertEqual(result['selectionDates'],3)
        self.assertFalse(result['independentAcceptance'])

    def test_selection_is_deterministic_and_does_not_accept_reserved_dates(self):
        a=m.calibrate(records());b=m.calibrate(records()[::-1])
        self.assertEqual(a['ridge'],b['ridge'])
        np.testing.assert_allclose(a['weights'],b['weights'],atol=1e-12)
        with self.assertRaises(ValueError): m.calibrate(records(),forbidden_dates={'2026-01-02'})
        for bad in [records()[:1],records()+[records()[0]], [{**records()[0],'date':'yesterday'}]]:
            with self.assertRaises(ValueError): m.calibrate(bad)

    def test_balanced_loss_is_not_dominated_by_background_cell_count(self):
        self.assertAlmostEqual(m.balanced_loss([
            {'labels':np.array([1,0]),'scores':np.array([0.,0.])}]),.5)
        self.assertAlmostEqual(m.balanced_loss([
            {'labels':np.array([1]+[0]*99),'scores':np.zeros(100)}]),.5)
        with self.assertRaises(ValueError): m.balanced_loss([{'labels':np.array([0]),'scores':np.array([0.])}])

if __name__=='__main__': unittest.main()
