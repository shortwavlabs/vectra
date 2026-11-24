// P0-G5 privacy: observe every request (page and workers) and WebSocket during a complete
// import → trace (all modes) → export session, and repeat the workflow offline.
import { readFileSync } from "node:fs";
import { expect, test, type Request } from "@playwright/test";
import {
  fixture,
  selectMode,
  uploadGenerated,
  waitForSource,
  waitForState,
  writeOutput,
} from "./helpers.ts";

const TOKEN = "PRIVATE-artwork-7f3c9e";

async function session(page: import("@playwright/test").Page) {
  await page.getByTestId("file").setInputFiles({
    name: `${TOKEN}.png`,
    mimeType: "image/png",
    buffer: readFileSync(fixture("procedural/nested_rings.png")),
  });
  for (const mode of ["bw", "color", "limited", "halftone"]) {
    await selectMode(page, mode);
    await waitForState(page, "done");
  }
  await selectMode(page, "bw");
  await page.getByLabel(/^Threshold/).focus();
  await page.getByLabel(/^Threshold/).press("ArrowLeft");
  await waitForState(page, "done");
  const svg = page.waitForEvent("download");
  await page.getByTestId("download-svg").click();
  await (await svg).path();
  const pdf = page.waitForEvent("download");
  await page.getByTestId("download-pdf").click();
  await (await pdf).path();
}

test("no artwork bytes, filename, settings or exports are transmitted", async ({
  page,
  context,
  browserName,
  baseURL,
}) => {
  const log: { phase: string; url: string; method: string; type: string; bodyBytes: number }[] = [];
  let phase = "load";
  const record = (r: Request) =>
    log.push({
      phase,
      url: r.url(),
      method: r.method(),
      type: r.resourceType(),
      bodyBytes: r.postDataBuffer()?.length ?? 0,
    });
  context.on("request", record);
  page.on("websocket", (ws) =>
    log.push({ phase, url: ws.url(), method: "WEBSOCKET", type: "websocket", bodyBytes: 0 }),
  );
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as unknown as { __vectra?: { ready?: unknown } }).__vectra?.ready),
      ),
    )
    .toBe(true);
  phase = "session";
  await session(page);
  writeOutput(`privacy/${browserName}-requests.json`, JSON.stringify(log, null, 2));

  const origin = new URL(baseURL!).origin;
  for (const r of log) {
    expect(r.method === "GET" || r.url.startsWith("blob:"), JSON.stringify(r)).toBe(true);
    expect(r.bodyBytes, JSON.stringify(r)).toBe(0);
    expect(
      r.url.startsWith(origin) || r.url.startsWith("blob:") || r.url.startsWith("data:"),
      JSON.stringify(r),
    ).toBe(true);
    expect(r.url).not.toContain(TOKEN);
    expect(r.url).not.toMatch(/threshold|nested_rings|\.png/i);
  }
  // After start-up, the session itself must not hit the network at all (blob: downloads are local).
  expect(
    log.filter(
      (r) => r.phase === "session" && !r.url.startsWith("blob:") && !r.url.startsWith("data:"),
    ),
  ).toEqual([]);
});

test("the complete workflow works offline once the application has loaded", async ({
  page,
  context,
  browserName,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("offline-ready")).toHaveText("Offline-ready.", { timeout: 30_000 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as unknown as { __vectra?: { ready?: unknown } }).__vectra?.ready),
      ),
    )
    .toBe(true);
  await context.setOffline(true);
  await session(page);
  // Cancellation recreates the worker; since P0-R the service worker serves it offline.
  await page.getByTestId("mode").selectOption("color");
  await uploadGenerated(page, {
    width: 3000,
    height: 3000,
    type: "image/jpeg",
    name: "offline-large.jpg",
  });
  await waitForSource(page, 3000, 3000);
  await waitForState(page, "processing");
  await page.getByTestId("cancel").click();
  await waitForState(page, "cancelled");
  await page.getByTestId("file").setInputFiles(fixture("procedural/circle.png"));
  await waitForState(page, "done", 30_000);
  writeOutput(
    `privacy/${browserName}-offline.json`,
    JSON.stringify({ offlineSession: "passed", workerRecreatedOffline: true }, null, 2),
  );
  await context.setOffline(false);
});
