import unittest
import numpy as np
from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path
spec = spec_from_file_location("role_linear", Path(__file__).with_name("role-linear-probe.py"))
m = module_from_spec(spec)
spec.loader.exec_module(m)


def row(role, seed, date="train"):
    a = np.zeros(512); a[m.ROLES.index(role)] = 1; a[10+seed] = 0.01
    return {"role": role, "reviewed": True, "date": date, "sha256": str(seed),
            "views": [{"view": v, "embedding": a.tolist()} for v in m.VIEWS]}


class RoleLinearTests(unittest.TestCase):
    def setUp(self):
        self.rows = [row(role, k) for k, role in enumerate(m.ROLES)]
        self.model = m.fit(self.rows)

    def test_separable_generated_roles_but_no_business_authority(self):
        for k, role in enumerate(m.ROLES):
            p = m.predict(self.model, row(role, k+10, "evaluation"))
            self.assertEqual(p["candidate"], None if role == "mixed-scene" else role)
            self.assertFalse(p["bindingVerified"] or p["mayAuthorizeUpload"] or p["mayClearCodeConflict"])

    def test_date_or_content_overlap_rejected(self):
        for r in [row("paper", 15), row("paper", 0, "evaluation")]:
            with self.assertRaises(ValueError): m.predict(self.model, r)

    def test_missing_class_unreviewed_or_corrupt_features_rejected(self):
        with self.assertRaises(ValueError): m.fit(self.rows[:3])
        r = row("paper", 15, "evaluation"); r["views"][0]["embedding"][0] = float("nan")
        with self.assertRaises(ValueError): m.predict(self.model, r)
        self.rows[0]["reviewed"] = False
        with self.assertRaises(ValueError): m.fit(self.rows)

    def test_two_views_disagree_or_ambiguous_is_not_majority_vote(self):
        r = row("paper", 15, "evaluation")
        r["views"][1] = row("water", 16, "evaluation")["views"][1]
        self.assertIsNone(m.predict(self.model, r)["candidate"])

    def test_multilabel_preserves_mixed_scene_and_rejects_role_disagreement(self):
        model=m.fit_multilabel(self.rows)
        for k,role in enumerate(m.ROLES):
            p=m.predict_multilabel(model,row(role,k+10,"evaluation"))
            self.assertEqual(p["candidate"],None if role=="mixed-scene" else role)
            if role=="mixed-scene":self.assertEqual([v["role"] for v in p["views"]],["mixed-scene"]*2)
            self.assertFalse(p["mayAuthorizeUpload"])
        r=row("lamp",15,"evaluation");r["views"][1]=row("water",16,"evaluation")["views"][1]
        self.assertIsNone(m.predict_multilabel(model,r)["candidate"])
        with self.assertRaises(ValueError):m.predict_multilabel(model,self.rows[0])
        for v in r["views"]:
            v["embedding"] = [1,1,1,1] + [0]*508
        self.assertIsNone(m.predict(self.model, r)["candidate"])


if __name__ == "__main__": unittest.main()
