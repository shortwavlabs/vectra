#!/bin/sh
# Sequential timing runs for R01/R02/R05-B. Records machine load before each step because the
# reference machine had unrelated CPU-bound processes during this review.
# Usage (repo root, server on :4199): sh experiments/rfc-002-review/bench/run-all-timing.sh
set -u
B=experiments/rfc-002-review/bench
A=docs/research/rfc-002-review/artifacts
LOG=$A/renderer/timing-environment.txt
note() { echo "== $1 $(date -u +%FT%TZ) | $(uptime | sed 's/.*load/load/') | unrelated ngspice procs: $(ps -A | grep -c '[n]gspice')" >> $LOG; }
: > $LOG
sysctl -n machdep.cpu.brand_string hw.memsize hw.ncpu >> $LOG; sw_vers >> $LOG
note probe;      node $B/run-probe.mjs > $A/renderer/environment-probe.json
note transport;  node $B/run-transport.mjs chromium,firefox,webkit > $A/transport/browser-transport.json
note node-transport; node $B/transport-node.mjs > $A/transport/node-transport.json
REAL="real:concert-small-venue-bw,real:concert-small-venue-1280-halftone,real:architecture-street-bw,real:texture-bark-bw,real:architecture-street-limited,synth:synthetic-many-250k,real:portrait-large-color,synth:synthetic-many-500k,real:portrait-face-limited,real:architecture-street-halftone,synth:synthetic-many-1m"
note render-chromium; OUT=$A/renderer/bench-chromium.json node $B/run-render.mjs bench chromium canvas,svgdom,svgimg,webgl $REAL 6
SMALL="real:concert-small-venue-bw,real:concert-small-venue-1280-halftone,real:architecture-street-limited,real:portrait-large-color,real:architecture-street-halftone,synth:synthetic-many-1m"
note render-firefox; OUT=$A/renderer/bench-firefox.json node $B/run-render.mjs bench firefox canvas,svgdom,svgimg,webgl $SMALL 6
note render-webkit;  OUT=$A/renderer/bench-webkit.json node $B/run-render.mjs bench webkit canvas,svgdom,svgimg,webgl $SMALL 6
note persist;    node $B/run-persist.mjs > $A/persistence/compression.json
note done
