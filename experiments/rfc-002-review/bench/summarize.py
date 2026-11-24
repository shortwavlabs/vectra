"""Markdown tables from the raw R01/R02/R05-B results (stdlib only; no hand transcription).
Usage: python3 summarize.py <artifacts dir> transport|renderer|persistence"""
import json
import statistics as st
import sys

A, what = sys.argv[1], sys.argv[2]


def med(xs):
    xs = [x for x in xs if isinstance(x, (int, float))]
    return st.median(xs) if xs else None


def f(v, nd=1):
    return "—" if v is None else (f"{v:,.{nd}f}" if isinstance(v, float) else f"{v:,}")


if what == "transport":
    node = json.load(open(f"{A}/transport/node-transport.json"))
    print(f"Node {node['node']} ({node['platform']}), {node['reps']} reps (cold + 5 warm); warm p50 unless marked.\n")
    print("| Scene | Anchors | Paths | Subpaths | JSON MB | Packet MB | JSON deflate MB | Packet deflate MB | String decode ms | JSON.parse ms | Parsed heap MB | JS encode ms (not prod. path) | Packet validate ms | Copy-out ms (wasm-bindgen equiv.) | Packet resident MB |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in node["results"]:
        e, j, p = r["encode"], r["json"], r["packet"]
        print(f"| {r['name']} | {p['anchors']:,} | {e['paths']:,} | {p['subpaths']:,} | {e['jsonBytes']/1e6:.1f} | {e['binBytes']/1e6:.1f} | {e['jsonDeflate']/1e6:.1f} | {e['binDeflate']/1e6:.1f} | {j['decodeMs']['p50']} | {j['parseMs']['p50']} | {j['residentHeap']/1e6:.1f} | {e['encodeMs']['p50']} | {p['validateMs']['p50']} | {p['wasmCopyOutMs']['p50']} | {p['residentArrayBuffers']/1e6:.1f} |")
    br = json.load(open(f"{A}/transport/browser-transport.json"))
    print("\nBrowser (headed, production CSP; warm median of 5; ms). deliver = worker post → main onmessage (cross-context clock); p/v = JSON.parse or packet validate; Path2D = renderer-ready path objects via SVG path data; gap = largest main-thread frame gap in the window.\n")
    print("| Engine | Scene | JSON string: deliver / parse / Path2D / total / gap | JSON object clone: deliver / total / gap | Packet transfer: deliver / validate / Path2D / total / gap |")
    print("|---|---|---|---|---|")
    for r in br:
        def m(mode, k):
            return med([x.get(k) for x in r["results"] if x["mode"] == mode and x["rep"] > 0])
        print(f"| {r['engine']} {r['version']} | {r['name']} | {f(m('json-string','deliverMs'))} / {f(m('json-string','parseMs'))} / {f(m('json-string','path2dMs'))} / **{f(m('json-string','receiveToRendererMs'))}** / {f(m('json-string','maxFrameGapMs'),0)} | {f(m('json-object','deliverMs'))} / **{f(m('json-object','requestToRendererMs'))}** / {f(m('json-object','maxFrameGapMs'),0)} | {f(m('packet-transfer','deliverMs'))} / {f(m('packet-transfer','validateMs'))} / {f(m('packet-transfer','path2dMs'))} / **{f(m('packet-transfer','receiveToRendererMs'))}** / {f(m('packet-transfer','maxFrameGapMs'),0)} |")

elif what == "renderer":
    rows = []
    for eng in ("chromium", "firefox", "webkit"):
        try:
            rows += json.load(open(f"{A}/renderer/bench-{eng}.json"))
        except FileNotFoundError:
            pass
    print("Viewport 1280×800 CSS, DPR 2 (2560×1600 device px), headed. Load = cold (rep 0) and warm median (reps 1–5); interactions = median over 5 warm reps of each rep's p50/p95/max frame interval (30 frames, capped at 5 s); hit = warm per-query p95 (ms) from 300 random points per rep.\n")
    print("| Engine | Renderer | Scene | First visible cold / warm ms | Load max gap ms | Prepare ms | Index ms | Pan p50/p95/max | Zoom p50/p95/max | Translate p95 | >50 ms frames (pan+zoom) | Sync redraw p50 ms | Hit p95 ms | Select / palette / visibility visible ms | JS heap MB |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        if not r.get("ok"):
            print(f"| {r['engine']} | {r['renderer']} | {r['name']} | FAILED: {r.get('error','')[:80]} |||||||||||||")
            continue
        res = r["results"]
        cold, warm = res[0], res[1:]
        it = [x["interactions"] for x in warm if "interactions" in x]

        def s(k, q):
            return med([i[k][q] for i in it if isinstance(i.get(k), dict)])

        def lat(k):
            return med([i[k]["visibleMs"] for i in it if isinstance(i.get(k), dict)])
        over = sum((i["pan"]["over50"] + i["zoom"]["over50"]) for i in it)
        frames = sum((i["pan"]["n"] + i["zoom"]["n"]) for i in it)
        trunc = any(i["pan"]["truncated"] or i["zoom"]["truncated"] for i in it)
        print(f"| {r['engine']} | {r['renderer']} | {r['name']} | {f(cold['firstVisibleMs'],0)} / {f(med([x['firstVisibleMs'] for x in warm]),0)} | {f(med([x['loadMaxFrameGapMs'] for x in warm]),0)} | {f(med([x['prepareMs'] for x in warm]),0)} | {f(med([x['indexMs'] for x in warm]),0)} | {f(s('pan','p50'))}/{f(s('pan','p95'))}/{f(s('pan','max'))} | {f(s('zoom','p50'))}/{f(s('zoom','p95'))}/{f(s('zoom','max'))} | {f(s('translate','p95'))} | {over}/{frames}{' (truncated)' if trunc else ''} | {f(med([i['syncRedraw']['p50'] for i in it if i.get('syncRedraw')]))} | {f(med([i['hitTest']['warmP95'] for i in it]),4)} | {f(lat('selectLatencyMs'),0)} / {f(lat('paletteLatencyMs'),0)} / {f(lat('visibilityLatencyMs'),0)} | {f(med([x['memory'].get('jsHeapUsedBytes') for x in warm]) and med([x['memory'].get('jsHeapUsedBytes') for x in warm])/2**20,0)} |")

elif what == "persistence":
    d = json.load(open(f"{A}/persistence/compression.json"))
    print("| Engine | Packet | Bytes MB | deflate-raw MB | Compress ms | Decompress ms | SHA-256 ms | Round trip |")
    print("|---|---|---|---|---|---|---|---|")
    for e in d:
        for name in dict.fromkeys(r["name"] for r in e["results"]):
            rs = [r for r in e["results"] if r["name"] == name]
            print(f"| {e['engine']} {e['version']} | {name} | {rs[0]['bytes']/1e6:.1f} | {rs[0]['deflated']/1e6:.1f} | {f(med([r['compressMs'] for r in rs]),0)} | {f(med([r['decompressMs'] for r in rs]),0)} | {f(med([r['sha256Ms'] for r in rs]),0)} | {'ok' if all(r['roundTripOk'] for r in rs) else 'FAIL'} |")
