"""Offline fixed-feature role experiment; no production or image IO.

Ridge regression on manually reviewed roles. Features are existing frozen CLIP
views, not OCR, names, dates, file names, or page labels. Training dates must be
disjoint from evaluation dates. Scores are NOT probabilities; four-way role
classification includes mixed scenes. This is diagnostic, never upload consent.
"""
import numpy as np

ROLES = ("paper", "lamp", "water", "mixed-scene")
VIEWS = ("center-crop", "full-frame")
RIDGE = 0.1
MIN_GAP = 0.15


def normalized_views(row, dimensions=512):
    if type(dimensions) is not int or not 1 <= dimensions <= 4096:
        raise ValueError("Explicit bounded feature dimension required")
    views = row.get("views", [])
    if len(views) != 2 or set(v.get("view") for v in views) != set(VIEWS):
        raise ValueError("Incomplete feature views")
    arrays = []
    for name in VIEWS:
        a = np.asarray(next(v["embedding"] for v in views if v["view"] == name), dtype=np.float64)
        if a.shape != (dimensions,) or not np.isfinite(a).all() or np.linalg.norm(a) < 1e-8:
            raise ValueError("Invalid frozen embedding")
        arrays.append(a / np.linalg.norm(a))
    return arrays


def fit(rows, *, dimensions=512):
    if len(rows) < 4 or any(r.get("reviewed") is not True or r.get("role") not in ROLES for r in rows):
        raise ValueError("Manually reviewed training roles required")
    ids = [r["sha256"] for r in rows]
    if len(set(ids)) != len(ids) or any(not r.get("date") for r in rows):
        raise ValueError("Duplicate or missing training identity")
    if set(r["role"] for r in rows) != set(ROLES):
        raise ValueError("All four roles required")
    arrays = [normalized_views(r, dimensions) for r in rows]
    # Equal total influence per role. All constants fixed before evaluation.
    weights = np.array([len(rows) / (4 * sum(s["role"] == r["role"] for s in rows)) for r in rows])
    targets = np.array([[float(r["role"] == role) for role in ROLES] for r in rows])
    models = []
    for v in range(2):
        x = np.array([a[v] for a in arrays])
        mean_x = np.average(x, axis=0, weights=weights)
        mean_y = np.average(targets, axis=0, weights=weights)
        a = (x - mean_x) * np.sqrt(weights[:, None])
        b = (targets - mean_y) * np.sqrt(weights[:, None])
        dual = np.linalg.solve(a @ a.T + RIDGE * np.eye(len(rows)), b)
        models.append((mean_x, mean_y, a.T @ dual))
    return {"models": models, "dimensions": dimensions,
            "trainingDates": set(r["date"] for r in rows), "trainingHashes": set(ids)}


def predict(model, row, enforce_holdout=True):
    if enforce_holdout and (row["date"] in model["trainingDates"] or row["sha256"] in model["trainingHashes"]):
        raise ValueError("Training/evaluation identity leakage")
    arrays = normalized_views(row, model.get("dimensions", 512))
    results = []
    for a, (mean_x, mean_y, weights) in zip(arrays, model["models"]):
        scores = (a - mean_x) @ weights + mean_y
        order = np.argsort(-scores, kind="stable")
        results.append({"role": ROLES[order[0]], "gap": float(scores[order[0]] - scores[order[1]]),
                        "scores": [float(x) for x in scores]})
    candidate = results[0]["role"] if results[0]["role"] == results[1]["role"] and all(r["gap"] >= MIN_GAP for r in results) else None
    if candidate == "mixed-scene":
        candidate = None
    return {"candidate": candidate, "views": results, "bindingVerified": False,
            "mayAuthorizeUpload": False, "mayClearCodeConflict": False}


def fit_multilabel(rows):
    # Reuse strict training schema checks; the exclusive model is not used.
    checked = fit(rows)
    arrays = [normalized_views(r) for r in rows]
    target_map = {"paper": (1,0,0), "lamp": (0,1,0), "water": (0,0,1), "mixed-scene": (0,1,1)}
    targets = np.array([target_map[r["role"]] for r in rows], dtype=np.float64)
    models=[]
    for v in range(2):
        x=np.array([a[v] for a in arrays]); heads=[]
        for k in range(3):
            y=targets[:, k]; positives=sum(y); negatives=len(y)-positives
            weights=np.where(y==1, len(y)/(2*positives), len(y)/(2*negatives))
            mean_x=np.average(x,axis=0,weights=weights);mean_y=np.average(y,weights=weights)
            a=(x-mean_x)*np.sqrt(weights[:,None]);b=(y-mean_y)*np.sqrt(weights)
            heads.append((mean_x,mean_y,a.T@np.linalg.solve(a@a.T+RIDGE*np.eye(len(rows)),b)))
        models.append(heads)
    return {**checked,"models":models}


def predict_multilabel(model,row,enforce_holdout=True):
    if enforce_holdout and (row["date"] in model["trainingDates"] or row["sha256"] in model["trainingHashes"]):
        raise ValueError("Training/evaluation identity leakage")
    arrays=normalized_views(row);results=[]
    for a,heads in zip(arrays,model["models"]):
        scores=[float((a-mx)@w+my) for mx,my,w in heads]
        pattern=tuple(int(s>.5) for s in scores)
        role={(1,0,0):"paper",(0,1,0):"lamp",(0,0,1):"water",(0,1,1):"mixed-scene"}.get(pattern)
        gap=min(abs(s-.5) for s in scores)
        results.append({"role":role,"gap":gap,"scores":scores})
    candidate=results[0]["role"] if results[0]["role"]==results[1]["role"] and all(r["gap"]>=MIN_GAP for r in results) else None
    if candidate=="mixed-scene":candidate=None
    return {"candidate":candidate,"views":results,"bindingVerified":False,
            "mayAuthorizeUpload":False,"mayClearCodeConflict":False}
