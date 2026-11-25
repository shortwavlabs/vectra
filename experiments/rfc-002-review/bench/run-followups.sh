#!/bin/sh
# R02 follow-up checks (run after run-all-timing.sh): raster truth, traced presentation,
# display-cache variant, spatial-index comparison. Records load before each step.
set -u
B=experiments/rfc-002-review/bench
A=docs/research/rfc-002-review/artifacts
LOG=$A/renderer/timing-environment.txt
note() { echo "== $1 $(date -u +%FT%TZ) | $(uptime | sed 's/.*load/load/') | unrelated ngspice procs: $(ps -A | grep -c '[n]gspice')" >> $LOG; }
note rastercheck; node $B/run-rastercheck.mjs > $A/renderer/rastercheck.json
note framecheck;  node $B/run-framecheck.mjs canvas,svgdom,svgimg,webgl real:portrait-large-color,real:architecture-street-halftone,synth:synthetic-many-1m > $A/renderer/framecheck.json
CACHE="real:concert-small-venue-1280-halftone,real:architecture-street-limited,real:portrait-large-color,real:architecture-street-halftone,synth:synthetic-many-1m"
note cache-chromium; QS="&cache=1" OUT=$A/renderer/bench-cache-chromium.json node $B/run-render.mjs bench chromium canvas $CACHE 6
note cache-firefox;  QS="&cache=1" OUT=$A/renderer/bench-cache-firefox.json node $B/run-render.mjs bench firefox canvas $CACHE 6
note cache-webkit;   QS="&cache=1" OUT=$A/renderer/bench-cache-webkit.json node $B/run-render.mjs bench webkit canvas $CACHE 6
note index-bench; node $B/index-bench.mjs > $A/renderer/index-bench.json
note followups-done
