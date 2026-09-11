import copy
import importlib.util
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('probe',Path(__file__).with_name('positioned-field-probe.py'))
probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)

def views(name):
    fields=[dict(regionIndex=i,region=dict(left=.48,top=y,width=.04,height=.12),crop={},text=t,confidence=.99)
            for i,(t,y) in enumerate([('佛光注照',.2),(name,.46),('之禄位',.72)])]
    return [dict(view=n,text='。'.join(f['text'] for f in fields) if i>=2 else '',lineCount=3 if i>=2 else 0,
                 errors=0,truncated=False,positioned=dict(schemaVersion=1,dimensions=dict(width=1000,height=1000),fields=copy.deepcopy(fields) if i>=2 else []))
            for i,n in enumerate(probe.NAMES)]

LAYOUT=dict(candidate=True,localSupport=dict(observed=True,matrix=[[1,0,0],[0,1,0],[0,0,1]],
        sourceHull=[[0,0],[999,0],[999,999],[0,999]],projectedHull=[[0,0],[999,0],[999,999],[0,999]]))

def pages():
    return [dict(pdfSha256='a'*64,pageNumber=i+1,fieldTexts=[name],views=views(name)) for i,name in enumerate(['甲方姓名','乙方姓名'])]

class PositionedFields(unittest.TestCase):
    def compare(self,p=None,v=None,l=None):return probe.compare_positioned_fields(p or pages(),v or views('甲方姓名'),l or [copy.deepcopy(LAYOUT) for _ in range(2)])
    def test_shared_template_requires_unique_composite(self):
        r=self.compare();self.assertEqual([x['uniqueComposite'] for x in r['rows']],[True,False]);self.assertFalse(r['mayAssign']);self.assertFalse(r['mayClearCodeConflict'])
    def test_same_name_in_another_format_not_another_tablet(self):
        p=pages();extra=copy.deepcopy(p[0]);extra['pageNumber']=3
        for v in extra['views']:
            v['positioned']['fields']=v['positioned']['fields'][1:2];v['text']='。'.join(f['text'] for f in v['positioned']['fields']);v['lineCount']=len(v['positioned']['fields'])
        p.append(extra);r=self.compare(p=p,l=[LAYOUT,LAYOUT,LAYOUT]);self.assertEqual(r['candidates'],1)
    def test_duplicate_tablet_cannot_be_unique(self):
        p=pages();p[1]['views']=views('甲方姓名');p[1]['fieldTexts']=['甲方姓名'];self.assertEqual(self.compare(p=p)['candidates'],0)
    def test_background_name_is_not_at_projected_position(self):
        v=views('甲方姓名')
        for x in v[2:]:x['positioned']['fields'][1]['region']['left']=.1
        self.assertEqual(self.compare(v=v)['candidates'],0)
    def test_same_name_twice_is_not_one_field(self):
        v=views('甲方姓名')
        for x in v[2:]:
            f=copy.deepcopy(x['positioned']['fields'][1]);f['regionIndex']=10;x['positioned']['fields'].append(f);x['text']+='。'+f['text'];x['lineCount']+=1
        self.assertEqual(self.compare(v=v)['candidates'],0)
    def test_one_view_name_is_insufficient(self):
        v=views('甲方姓名');v[3]['positioned']['fields'][1]['text']='其他姓名';v[3]['text']='。'.join(f['text'] for f in v[3]['positioned']['fields'])
        self.assertEqual(self.compare(v=v)['candidates'],0)
    def test_partial_support_and_no_proposal(self):
        l=copy.deepcopy(LAYOUT);l['candidate']=False;self.assertEqual(self.compare(l=[l,l])['candidates'],0)
        l=copy.deepcopy(LAYOUT);l['localSupport']['sourceHull']=[[0,0],[999,0],[999,100],[0,100]];self.assertEqual(self.compare(l=[l,l])['candidates'],0)
    def test_foreign_page_failure_blocks_whole_corpus(self):
        p=pages();p[1]['views'][0]['errors']=1
        with self.assertRaises(ValueError):self.compare(p=p)
    def test_changed_positions_or_transcript_rejected(self):
        v=views('甲方姓名');v[3]['positioned']['fields'][1]['region']['top']=.47
        self.assertEqual(self.compare(v=v)['candidates'],0)
        v=views('甲方姓名');v[2]['text']='伪造'
        with self.assertRaises(ValueError):self.compare(v=v)
    def test_mirror_does_not_correspond(self):
        l=copy.deepcopy(LAYOUT);l['localSupport']['matrix']=[[-1,0,999],[0,1,0],[0,0,1]];self.assertEqual(self.compare(l=[l,l])['candidates'],0)
    def test_multiline_extraction_does_not_hide_duplicate_fields(self):
        p=pages();p[1]['fieldTexts']=['甲方姓名\n之禄位\n佛光注照'];self.assertEqual(self.compare(p=p)['candidates'],0)
    def test_invalid_page_identity(self):
        p=pages();p[0]['pdfSha256']='not-a-hash'
        with self.assertRaises(ValueError):self.compare(p=p)

if __name__=='__main__':unittest.main()
