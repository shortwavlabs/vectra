import { useEffect, useState } from "react";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import type { LengthUnit } from "./vectorization/types.ts";
import { useWorkbench } from "./workspace/useWorkbench.ts";

const fmtMs = (v: number | undefined) => (v === undefined ? "—" : `${v.toFixed(1)} ms`);
const fmtBytes = (v: number | undefined) =>
  v === undefined
    ? "—"
    : v > 1_048_576
      ? `${(v / 1_048_576).toFixed(2)} MiB`
      : `${(v / 1024).toFixed(1)} KiB`;

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, []);
  return <>{((now - since) / 1000).toFixed(1)} s</>;
}

export function App() {
  const wb = useWorkbench();
  const { source, status, result, pdf } = wb;
  const [dragging, setDragging] = useState(false);
  const [pdfWidth, setPdfWidth] = useState(200);
  const [pdfUnit, setPdfUnit] = useState<LengthUnit>("mm");
  const processing = status.kind === "processing";
  const m = result?.metrics;

  return (
    <div className="app">
      <header>
        <h1>Vectra · P0 engineering workbench</h1>
        <p className="note">
          Temporary evaluation harness. Images are processed locally in a Web Worker; nothing is
          uploaded.
        </p>
      </header>

      <aside>
        <section
          className={`drop${dragging ? " over" : ""}`}
          data-testid="dropzone"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) void wb.loadFile(f);
          }}
        >
          <label>
            <span>Image (PNG, JPEG, WebP; drop here or choose)</span>
            <input
              type="file"
              data-testid="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) void wb.loadFile(f);
              }}
            />
          </label>
          <label>
            <span>Pixel limit</span>
            <select
              data-testid="max-pixels"
              value={wb.maxPixels}
              onChange={(e) => wb.setMaxPixels(Number(e.currentTarget.value))}
            >
              <option value={12_000_000}>12 MP (default)</option>
              <option value={25_000_000}>25 MP (engineering override)</option>
              <option value={50_000_000}>50 MP (engine ceiling)</option>
            </select>
          </label>
        </section>

        <SettingsPanel settings={wb.settings} onChange={wb.setSettings} />

        <section className="panel" aria-label="Status">
          <p role="status" aria-live="polite" data-testid="status" data-state={status.kind}>
            {status.kind === "idle" && "Idle — choose an image."}
            {status.kind === "decoding" && "Decoding image…"}
            {status.kind === "processing" && (
              <>
                Processing (indeterminate) <Elapsed since={status.since} />
              </>
            )}
            {status.kind === "done" && "Done."}
            {status.kind === "cancelled" &&
              `Cancelled (acknowledged in ${status.ackMs.toFixed(1)} ms).`}
            {status.kind === "error" && `Error [${status.code}]: ${status.message}`}
          </p>
          <button type="button" data-testid="cancel" onClick={wb.cancel} disabled={!processing}>
            Cancel
          </button>
        </section>

        <section className="panel" aria-label="Export">
          <button
            type="button"
            data-testid="download-svg"
            onClick={wb.downloadSvg}
            disabled={!result || processing}
          >
            Download SVG
          </button>
          <div className="row">
            <label>
              <span>PDF width</span>
              <input
                type="number"
                data-testid="pdf-width"
                min={1}
                max={5000}
                value={pdfWidth}
                onChange={(e) => setPdfWidth(e.currentTarget.valueAsNumber)}
              />
            </label>
            <label>
              <span>Unit</span>
              <select
                data-testid="pdf-unit"
                value={pdfUnit}
                onChange={(e) => setPdfUnit(e.currentTarget.value as LengthUnit)}
              >
                <option value="mm">mm</option>
                <option value="in">in</option>
                <option value="pt">pt</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            data-testid="download-pdf"
            onClick={() => void wb.downloadPdf({ width: pdfWidth, unit: pdfUnit })}
            disabled={!result || processing || !(pdfWidth > 0)}
          >
            Download PDF
          </button>
        </section>
      </aside>

      <main>
        <div className="previews">
          <figure>
            <figcaption>
              Original {source && `· ${source.width}×${source.height} ${source.format}`}
            </figcaption>
            {source ? (
              <img src={source.url} alt="Original raster input" data-testid="original" />
            ) : (
              <div className="empty">No image</div>
            )}
          </figure>
          <figure className={processing && result ? "stale" : undefined}>
            <figcaption>
              Vector result {result && `· ${m?.mode}`}{" "}
              {processing && result && "· outdated, re-processing…"}
            </figcaption>
            {result ? (
              <img src={result.svgUrl} alt="Vectorized SVG result" data-testid="result" />
            ) : (
              <div className="empty">No result</div>
            )}
          </figure>
        </div>

        {result && result.warnings.length > 0 && (
          <ul className="warnings" data-testid="warnings">
            {result.warnings.map((w) => (
              <li key={w.code}>
                <code>{w.code}</code> {w.message}
              </li>
            ))}
          </ul>
        )}

        <table className="metrics" data-testid="metrics">
          <tbody>
            <tr>
              <th>Decode (main thread)</th>
              <td>{fmtMs(source?.decodeMs)}</td>
              <th>Paths / subpaths</th>
              <td data-testid="paths">{m ? `${m.stats.paths} / ${m.stats.subpaths}` : "—"}</td>
            </tr>
            <tr>
              <th>WASM call (trace + SVG)</th>
              <td>{fmtMs(result?.timings.wasmCallMs)}</td>
              <th>Anchors (lines / cubics)</th>
              <td>{m ? `${m.stats.anchors} (${m.stats.lines} / ${m.stats.cubics})` : "—"}</td>
            </tr>
            <tr>
              <th>Pre-process / segment</th>
              <td>
                {m ? `${fmtMs(m.timingsMs.preprocess)} / ${fmtMs(m.timingsMs.segment)}` : "—"}
              </td>
              <th>Palette / dots</th>
              <td>{m ? `${m.paletteSize} / ${m.dots}` : "—"}</td>
            </tr>
            <tr>
              <th>Fit (compose) / optimise</th>
              <td>{m ? `${fmtMs(m.timingsMs.compose)} / ${fmtMs(m.timingsMs.optimize)}` : "—"}</td>
              <th>SVG size</th>
              <td data-testid="svg-bytes">{fmtBytes(result?.svgBytes)}</td>
            </tr>
            <tr>
              <th>SVG serialise / round trip</th>
              <td>
                {result ? `${fmtMs(result.timings.svgMs)} / ${fmtMs(result.roundTripMs)}` : "—"}
              </td>
              <th>PDF size / time</th>
              <td data-testid="pdf-bytes">
                {pdf ? `${fmtBytes(pdf.bytes)} / ${fmtMs(pdf.ms)}` : "—"}
              </td>
            </tr>
            <tr>
              <th>Max frame gap / long tasks</th>
              <td>
                {result
                  ? `${fmtMs(result.responsiveness.maxFrameGapMs)} / ${result.responsiveness.longTasks}`
                  : "—"}
              </td>
              <th>WASM memory</th>
              <td>{fmtBytes(result?.memoryBytes)}</td>
            </tr>
          </tbody>
        </table>
      </main>
    </div>
  );
}
