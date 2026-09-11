import unittest
import importlib.util
from pathlib import Path

spec=importlib.util.spec_from_file_location('windows',Path(__file__).with_name('paper-reading-windows.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class WindowTests(unittest.TestCase):
    def test_small_overlapping_regions_locate_reading_only(self):
        result=m.reading_windows(1800,1350,[[[7,7]],[[7,7]]])
        self.assertEqual(len(result['windows']),2)
        self.assertEqual(result['windows'][0],{'left':771,'top':578,'width':387,'height':290,'paddingCells':1})
        for key in ('paperRoleVerified','codeVerified','mayAuthorizeUpload','independentViews'):
            self.assertFalse(result[key])

    def test_nonoverlapping_or_missing_views_do_not_invent_a_region(self):
        self.assertEqual(m.reading_windows(1800,1350,[[[0,0]],[[13,13]]])['windows'],[])
        self.assertEqual(m.reading_windows(1800,1350,[[],[[7,7]]])['windows'],[])

    def test_bounds_are_oriented_and_clipped_without_duplicate_full_frame(self):
        cells=[[y,x] for y in range(14) for x in range(14)]
        r=m.reading_windows(1351,1800,[cells,cells])
        self.assertEqual(r['windows'],[{'left':0,'top':0,'width':1351,'height':1800,'paddingCells':1}])

    def test_malformed_disconnected_or_duplicate_cells_are_rejected(self):
        good=[[[7,7]],[[7,7]]]
        for w,h in [(0,100),(True,100),(100,1.2)]:
            with self.assertRaises(ValueError):m.reading_windows(w,h,good)
        for bad in [[[[14,0]],[[7,7]]],[[[1.2,1]],[[7,7]]],
                    [[[1,1],[1,1]],[[7,7]]],[[[1,1],[9,9]],[[7,7]]],[[[True,1]],[[7,7]]]]:
            with self.assertRaises(ValueError):m.reading_windows(1800,1350,bad)

if __name__=='__main__':unittest.main()
