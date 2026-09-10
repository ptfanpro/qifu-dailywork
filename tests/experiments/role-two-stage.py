"""Two-stage, fixed-feature diagnostic; never imported by production.

The foreground-paper decision has its own balanced binary head. Only reviewed
lamp/water labels train the second head: disputed mixed-scene labels are known
non-paper examples, NOT assertions about the liquid in any bowl. The two views
share one encoder and are consistency checks, not independent model votes.
No open-set or mixed-object detection is claimed by a binary category head.
"""
import numpy as np

VIEWS = ("center-crop", "full-frame")
ROLES = ("paper", "lamp", "water", "mixed-scene")
RIDGE = 0.1
# Inherited unchanged from the previous binary-head experiment. Scores are not
# calibrated probabilities. Never tune this constant against evaluation labels.
MIN_GAP = 0.15


def normalized_views(row):
    views = row.get("views", [])
    if len(views) != 2 or {v.get("view") for v in views} != set(VIEWS):
        raise ValueError("Incomplete feature views")
    arrays = []
    for name in VIEWS:
        a = np.asarray(next(v["embedding"] for v in views if v["view"] == name), dtype=np.float64)
        if a.shape != (512,) or not np.isfinite(a).all() or np.linalg.norm(a) < 1e-8:
            raise ValueError("Invalid frozen embedding")
        arrays.append(a / np.linalg.norm(a))
    return arrays


def fit_head(x, targets):
    y = np.asarray(targets, dtype=np.float64)
    positives, negatives = np.sum(y), len(y) - np.sum(y)
    if not positives or not negatives:
        raise ValueError("Both binary labels required")
    weights = np.where(y == 1, len(y) / (2 * positives), len(y) / (2 * negatives))
    mean_x = np.average(x, axis=0, weights=weights)
    mean_y = np.average(y, weights=weights)
    a = (x - mean_x) * np.sqrt(weights[:, None])
    b = (y - mean_y) * np.sqrt(weights)
    return mean_x, mean_y, a.T @ np.linalg.solve(a @ a.T + RIDGE * np.eye(len(y)), b)


def fit(rows):
    if any(r.get("reviewed") is not True or r.get("role") not in ROLES for r in rows):
        raise ValueError("Manually reviewed training roles required")
    ids = [r.get("sha256") for r in rows]
    if not all(ids) or len(set(ids)) != len(ids) or any(not r.get("date") for r in rows):
        raise ValueError("Duplicate or missing training identity")
    if not {"paper", "lamp", "water"}.issubset({r["role"] for r in rows}):
        raise ValueError("Paper and both unambiguous scene categories required")
    arrays = np.asarray([normalized_views(r) for r in rows])
    category_indices = [i for i, r in enumerate(rows) if r["role"] in ("lamp", "water")]
    paper_models, category_models = [], []
    for view in range(2):
        paper_models.append(fit_head(arrays[:, view, :], [r["role"] == "paper" for r in rows]))
        category_models.append(fit_head(arrays[category_indices, view, :],
                                       [rows[i]["role"] == "lamp" for i in category_indices]))
    return {"paperModels": paper_models, "categoryModels": category_models,
            "trainingDates": {r["date"] for r in rows}, "trainingHashes": set(ids),
            "categoryTrainingCount": len(category_indices)}


def predict(model, row, enforce_holdout=True):
    if enforce_holdout and (row["date"] in model["trainingDates"] or row["sha256"] in model["trainingHashes"]):
        raise ValueError("Training/evaluation identity leakage")
    arrays = normalized_views(row)
    views = []
    for name, a, paper, category in zip(VIEWS, arrays, model["paperModels"], model["categoryModels"]):
        ps = float((a - paper[0]) @ paper[2] + paper[1])
        cs = float((a - category[0]) @ category[2] + category[1])
        views.append({"view": name, "paperScore": ps, "lampScore": cs,
                      "paperGap": abs(ps - 0.5), "categoryGap": abs(cs - 0.5)})
    candidate, reason = None, "paper-role-uncertain"
    if all(v["paperGap"] >= MIN_GAP for v in views):
        if all(v["paperScore"] > 0.5 for v in views):
            candidate, reason = "paper", "paper-head-consistent"
        elif all(v["paperScore"] < 0.5 for v in views):
            reason = "category-uncertain"
            if all(v["categoryGap"] >= MIN_GAP for v in views):
                if all(v["lampScore"] > 0.5 for v in views):
                    candidate, reason = "lamp", "both-heads-consistent"
                elif all(v["lampScore"] < 0.5 for v in views):
                    candidate, reason = "water", "both-heads-consistent"
    return {"candidate": candidate, "reason": reason, "views": views,
            "scoreIsProbability": False, "bindingVerified": False,
            "mayAuthorizeUpload": False, "mayClearCodeConflict": False}
