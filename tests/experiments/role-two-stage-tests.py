"""Synthetic contracts, not accuracy evidence for the scene experiment."""
import copy
import unittest
from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path
import numpy as np

spec = spec_from_file_location("two_stage", Path(__file__).with_name("role-two-stage.py"))
m = module_from_spec(spec)
spec.loader.exec_module(m)


def row(role, seed, date="train"):
    a = np.zeros(512)
    a[0 if role == "paper" else 1] = 1
    if role in ("lamp", "water"):
        a[2 if role == "lamp" else 3] = 1
    a[20 + seed] = 0.001
    return {"role": role, "reviewed": True, "date": date, "sha256": str(seed),
            "views": [{"view": v, "embedding": a.tolist()} for v in m.VIEWS]}


class TwoStageTests(unittest.TestCase):
    def setUp(self):
        self.rows = [row(r, k) for k, r in enumerate(("paper", "lamp", "water", "mixed-scene"))]
        self.model = m.fit(self.rows)

    def test_separable_roles_and_no_assignment_authority(self):
        for k, role in enumerate(("paper", "lamp", "water")):
            p = m.predict(self.model, row(role, 10 + k, "evaluation"))
            self.assertEqual(p["candidate"], role)
            self.assertFalse(p["bindingVerified"] or p["mayAuthorizeUpload"] or p["mayClearCodeConflict"])
            self.assertFalse(p["scoreIsProbability"])

    def test_ambiguous_scene_labels_never_train_lamp_water_head(self):
        without = m.fit(self.rows[:3])
        for old, new in zip(without["categoryModels"], self.model["categoryModels"]):
            for a, b in zip(old, new):
                np.testing.assert_array_equal(a, b)
        self.assertEqual(self.model["categoryTrainingCount"], 2)
        p = m.predict(self.model, row("mixed-scene", 10, "evaluation"))
        self.assertIsNone(p["candidate"])
        self.assertEqual(p["reason"], "category-uncertain")

    def test_holdout_leakage_is_rejected(self):
        for r in (row("paper", 15), row("paper", 0, "evaluation")):
            with self.assertRaises(ValueError):
                m.predict(self.model, r)

    def test_disagreeing_views_cannot_commit_a_role(self):
        r = row("paper", 15, "evaluation")
        r["views"][1] = row("lamp", 16, "evaluation")["views"][1]
        self.assertIsNone(m.predict(self.model, r)["candidate"])
        r = row("lamp", 15, "evaluation")
        r["views"][1] = row("water", 16, "evaluation")["views"][1]
        self.assertIsNone(m.predict(self.model, r)["candidate"])

    def test_names_dates_and_expected_answers_are_not_features(self):
        r = row("paper", 15, "evaluation")
        expected = m.predict(self.model, r)
        r.update(role="water", filename="2.5.jpg", date="another-held-out-date",
                 expectedRole="water", missingSceneSlots=["water"], expectedNumbers=[17])
        self.assertEqual(m.predict(self.model, r), expected)

    def test_missing_class_unreviewed_duplicate_or_invalid_vector_is_rejected(self):
        for rows in (self.rows[:2], self.rows + [self.rows[0]]):
            with self.assertRaises(ValueError): m.fit(rows)
        rows = copy.deepcopy(self.rows); rows[0]["reviewed"] = False
        with self.assertRaises(ValueError): m.fit(rows)
        for bad in (float("nan"), float("inf")):
            r = row("paper", 15, "evaluation"); r["views"][0]["embedding"][0] = bad
            with self.assertRaises(ValueError): m.predict(self.model, r)
        r = row("paper", 15, "evaluation"); r["views"][0]["embedding"] = [0] * 512
        with self.assertRaises(ValueError): m.predict(self.model, r)
        r = row("paper", 15, "evaluation"); r["views"][1]["view"] = "center-crop"
        with self.assertRaises(ValueError): m.predict(self.model, r)


if __name__ == "__main__": unittest.main()
