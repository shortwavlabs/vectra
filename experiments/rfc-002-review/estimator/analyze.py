"""R03 early-complexity estimator evaluation (stdlib only).

Joins runs.jsonl (segmentation features + actual anchors) with pre-features.jsonl
(O(pixels) features computed before segmentation) and evaluates linear predictors
anchors ~= k * feature with LEAVE-ONE-IMAGE-OUT calibration: for each held-out image, k is
fitted on the other images only (all their scales), so no threshold is tuned on the image it
predicts. A conservative rule (k = max training ratio x (1 + margin)) is used for the budget
decision (prefer false positives over false negatives); the median ratio gives the error
distribution. Usage: python3 analyze.py <artifact dir>
"""
import json
import statistics
import sys

d = sys.argv[1]
runs = [json.loads(l) for l in open(f"{d}/runs.jsonl")]
pre = {(r["image"], r["scale"]): r for r in map(json.loads, open(f"{d}/pre-features.jsonl"))}
for r in runs:
    r.update({k: v for k, v in pre[(r["image"], r["scale"])].items() if k not in ("image", "scale", "w", "h")})

BUDGET, WARN = 1_000_000, 250_000
FEATURES = {
    "bw": {"post: perimeter": "perimeter", "pre: luma transitions": "bwTransitions"},
    "color": {"post: perimeter": "perimeter", **{f"pre: quantized edges q{s}": f"q{s}" for s in (3, 4, 5, 6)}},
}
out = {"cases": len(runs), "budget": BUDGET, "warn": WARN, "predictors": []}
for mode, feats in FEATURES.items():
    rows = [r for r in runs if r["mode"] == mode and r["anchors"] is not None]
    images = sorted({r["image"] for r in rows})
    for label, f in feats.items():
        for margin in (0.0, 0.10, 0.25):
            fp = fn = tp = tn = wfp = wfn = 0
            errs, preds = [], []
            for img in images:
                train = [r for r in rows if r["image"] != img]
                ratios = [r["anchors"] / r[f] for r in train if r[f] > 0]
                k_max, k_med = max(ratios) * (1 + margin), statistics.median(ratios)
                for r in (r for r in rows if r["image"] == img):
                    pred, a = k_max * r[f], r["anchors"]
                    errs.append(abs(k_med * r[f] - a) / a)
                    over, actual = pred > BUDGET, a > BUDGET
                    tp += over and actual; tn += (not over) and (not actual)
                    fp += over and not actual; fn += actual and not over
                    wfp += (pred > WARN) and a <= WARN; wfn += a > WARN and pred <= WARN
                    preds.append({"image": img, "mp": r["mp"], "actual": a, "predConservative": round(pred)})
            out["predictors"].append({
                "mode": mode, "predictor": label, "margin": margin, "positives": tp + fn, "negatives": tn + fp,
                "budgetFP": fp, "budgetFN": fn, "warnFP": wfp, "warnFN": wfn,
                "medianAbsErrPct": round(100 * statistics.median(errs), 1), "p90AbsErrPct": round(100 * sorted(errs)[int(0.9 * len(errs))], 1),
                **({"predictions": preds} if margin == 0.10 else {}),
            })
# Time to an early answer, relative to the full trace (same process, same load).
timing = []
for r in runs:
    timing.append({"image": r["image"], "mode": r["mode"], "mp": r["mp"], "preMs": r["preMs"], "segMs": r["segMs"],
                   "traceMs": r["traceMs"], "segShareOfTrace": round(r["segMs"] / r["traceMs"], 3)})
out["timing"] = timing
col = [t for t in timing if t["mode"] == "color"]
out["timingSummary"] = {
    "colorSegShareMedian": statistics.median(t["segShareOfTrace"] for t in col),
    "colorSegShareMin": min(t["segShareOfTrace"] for t in col),
    "preMsMax": max(t["preMs"] for t in timing),
    "preMsAt12MP": [t["preMs"] for t in timing if abs(t["mp"] - 12.5) < 1 and t["mode"] == "color"],
}
json.dump(out, open(f"{d}/evaluation.json", "w"), indent=1)
print(f"{'mode':6} {'predictor':28} {'margin':>6} {'pos':>4} {'neg':>4} {'FP':>3} {'FN':>3} {'wFP':>4} {'wFN':>4} {'medErr%':>8} {'p90Err%':>8}")
for p in out["predictors"]:
    print(f"{p['mode']:6} {p['predictor']:28} {p['margin']:6.2f} {p['positives']:4} {p['negatives']:4} {p['budgetFP']:3} {p['budgetFN']:3} {p['warnFP']:4} {p['warnFN']:4} {p['medianAbsErrPct']:8} {p['p90AbsErrPct']:8}")
print(json.dumps(out["timingSummary"]))

# Predictor 3: extrapolate from the ~1 MP preview trace (which the UI needs anyway, TD-PERF-004):
# anchors(full) ~= anchors(1MP) * (MP / MP_1)^beta, beta = max over the OTHER images (LOIO),
# fitted from each image's (1 MP, larger scale) pairs. Only images with a downscaled 1 MP row.
res = []
for mode in ("color", "bw"):
    by = {}
    for r in runs:
        if r["mode"] == mode and r["anchors"] is not None:
            by.setdefault(r["image"], []).append(r)
    base = {img: next((r for r in rs if abs(r["mp"] - 1.0) < 0.05), None) for img, rs in by.items()}
    imgs = [i for i, b in base.items() if b]
    betas = {}
    import math
    for img in imgs:
        b = base[img]
        betas[img] = [math.log(r["anchors"] / b["anchors"]) / math.log(r["mp"] / b["mp"]) for r in by[img] if r["mp"] > 1.2]
    for margin in (0.0, 0.10):
        fp = fn = n_pos = n = 0
        errs, preview_ms, preds = [], [], []
        for img in imgs:
            train = [x for i in imgs if i != img for x in betas[i]]
            bmax, bmed = max(train), statistics.median(train)
            b = base[img]
            preview_ms.append(b["traceMs"])
            for r in by[img]:
                if r["mp"] <= 1.2:
                    continue
                n += 1
                pred = b["anchors"] * (r["mp"] / b["mp"]) ** bmax * (1 + margin)
                errs.append(abs(b["anchors"] * (r["mp"] / b["mp"]) ** bmed - r["anchors"]) / r["anchors"])
                pos = r["anchors"] > BUDGET
                n_pos += pos
                fp += pred > BUDGET and not pos
                fn += pos and pred <= BUDGET
                preds.append({"image": img, "mp": r["mp"], "actual": r["anchors"], "predConservative": round(pred)})
        res.append({"mode": mode, "predictor": "preview 1 MP trace, scale law", "margin": margin, "cases": n, "positives": n_pos,
                    "budgetFP": fp, "budgetFN": fn, "medianAbsErrPct": round(100 * statistics.median(errs), 1),
                    "p90AbsErrPct": round(100 * sorted(errs)[int(0.9 * len(errs))], 1),
                    "previewTraceMsMax": max(preview_ms), "previewTraceMsMedian": statistics.median(preview_ms),
                    "betaRange": [round(min(x for v in betas.values() for x in v), 3), round(max(x for v in betas.values() for x in v), 3)],
                    **({"predictions": preds} if margin == 0.10 else {})})
out["previewExtrapolation"] = res
json.dump(out, open(f"{d}/evaluation.json", "w"), indent=1)
for p in res:
    print({k: v for k, v in p.items() if k != "predictions"})
