// P0-G3 evaluation (not part of the product): convert the engine's own SVG exports to PDF
// with jsPDF 4.2.1 + svg2pdf.js 2.9.0 in a real browser, so the result can be inspected with
// the same qpdf/pdfimages/poppler checks as the engine's direct PDF writer.
// svg2pdf.js needs a live DOM, so this runs on the page's main thread (not in a worker).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "@playwright/test";
import { OUTPUT, writeOutput } from "./helpers.ts";

const NATIVE = join(OUTPUT, "native");
const SAMPLES = [
  "nested_rings-bw",
  "transparent_ring-color",
  "adjacent_colors-limited",
  "antialiased_discs-mosaic",
  "gradient-halftone",
  "gradient-halftone-transparent",
];
const modules = resolve(import.meta.dirname, "../../node_modules");

test("jsPDF + svg2pdf.js conversion of engine SVGs (evaluation)", async ({ page, browserName }) => {
  test.skip(
    !existsSync(NATIVE),
    "run `cargo run --release -p vector-engine --example export_samples` first",
  );
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ path: join(modules, "jspdf/dist/jspdf.umd.min.js") });
  await page.addScriptTag({ path: join(modules, "svg2pdf.js/dist/svg2pdf.umd.min.js") });
  const rows = [];
  for (const name of SAMPLES) {
    const svg = readFileSync(join(NATIVE, `${name}.svg`), "utf8");
    const result = await page.evaluate(async (svgText) => {
      const w = window as unknown as {
        jspdf: { jsPDF: new (o: object) => { output(t: string): ArrayBuffer } };
        svg2pdf: { svg2pdf(el: Element, pdf: unknown, o: object): Promise<unknown> };
      };
      const el = new DOMParser().parseFromString(svgText, "image/svg+xml").documentElement;
      document.body.replaceChildren(document.importNode(el, true));
      const svgEl = document.body.firstElementChild!;
      const vw = Number(svgEl.getAttribute("width"));
      const vh = Number(svgEl.getAttribute("height"));
      const pageW = (150 * 72) / 25.4;
      const pageH = (pageW * vh) / vw;
      const t0 = performance.now();
      const pdf = new w.jspdf.jsPDF({
        unit: "pt",
        format: [pageW, pageH],
        orientation: pageW > pageH ? "landscape" : "portrait",
        compress: true,
      });
      await w.svg2pdf.svg2pdf(svgEl, pdf, { x: 0, y: 0, width: pageW, height: pageH });
      const bytes = new Uint8Array(pdf.output("arraybuffer"));
      const ms = performance.now() - t0;
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      return { ms, b64: btoa(bin) };
    }, svg);
    const pdf = Buffer.from(result.b64, "base64");
    writeOutput(`pdf-eval/${browserName}/${name}.pdf`, pdf);
    writeOutput(`pdf-eval/${browserName}/${name}.svg`, svg);
    const enginePdf = readFileSync(join(NATIVE, `${name}.pdf`));
    rows.push({
      name,
      svg2pdfMs: result.ms,
      svg2pdfBytes: pdf.length,
      enginePdfBytes: enginePdf.length,
    });
  }
  writeOutput(`pdf-eval/${browserName}-summary.json`, JSON.stringify(rows, null, 2));
});
