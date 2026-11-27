// G-PRJ-R research probe (not built, not shipped). Feature detection plus small functional
// tests of the storage paths a project library and recovery could use. Writes a 32 MiB payload
// (a large project) and removes everything it created. Result: window.__probe.
const BYTES = 32 * 2 ** 20;
const has = (o: unknown, k: string) => !!o && k in (o as object);
type R = Record<string, unknown>;
/** A step that prompts or hangs (persist() in Firefox, for example) is recorded, not awaited forever. */
const within = <T>(p: Promise<T>, ms = 20_000): Promise<T | string> =>
  Promise.race([
    p,
    new Promise<string>((res) => setTimeout(() => res(`timeout after ${ms} ms`), ms)),
  ]);

async function opfs(): Promise<R> {
  const r: R = { getDirectory: typeof navigator.storage?.getDirectory === "function" };
  if (!r.getDirectory) return r;
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle("g-prj-probe.bin", { create: true });
    r.createWritable = typeof (fh as any).createWritable === "function";
    r.move = typeof (fh as any).move === "function";
    r.remove = typeof (fh as any).remove === "function";
    if (r.createWritable) {
      const data = new Uint8Array(BYTES).fill(1);
      let t = performance.now();
      const w = await (fh as any).createWritable();
      await w.write(data);
      await w.close();
      r.writeMs = +(performance.now() - t).toFixed(1);
      t = performance.now();
      const f = await fh.getFile();
      const back = new Uint8Array(await f.arrayBuffer());
      r.readMs = +(performance.now() - t).toFixed(1);
      r.readBackOk = back.length === BYTES && back[BYTES - 1] === 1;
      // Atomicity: a writable that is aborted must leave the committed file untouched.
      const w2 = await (fh as any).createWritable({ keepExistingData: false });
      await w2.write(new Uint8Array(1024).fill(2));
      await w2.abort();
      const after = new Uint8Array(await (await fh.getFile()).arrayBuffer());
      r.abortLeavesFileIntact = after.length === BYTES && after[0] === 1;
      if (r.move) {
        try {
          await (fh as any).move("g-prj-probe-moved.bin");
          r.moveWorks =
            (await root.getFileHandle("g-prj-probe-moved.bin")).name === "g-prj-probe-moved.bin";
          await root.removeEntry("g-prj-probe-moved.bin");
        } catch (e) {
          r.moveError = String(e);
          await root.removeEntry("g-prj-probe.bin").catch(() => {});
        }
      } else await root.removeEntry("g-prj-probe.bin");
    } else await root.removeEntry("g-prj-probe.bin");
    r.worker = await new Promise<R>((resolve) => {
      const wk = new Worker(new URL("./probe-worker.ts", import.meta.url), { type: "module" });
      wk.onmessage = (e) => (resolve(e.data), wk.terminate());
      wk.onerror = (e) => (resolve({ error: String(e.message) }), wk.terminate());
      wk.postMessage({ bytes: BYTES });
    });
  } catch (e) {
    r.error = String(e);
  }
  return r;
}

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const q = indexedDB.open("g-prj-probe", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("p");
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function idb(): Promise<R> {
  const r: R = { available: typeof indexedDB !== "undefined" };
  if (!r.available) return r;
  try {
    const db = await idbOpen();
    for (const durability of ["strict", "relaxed"] as const) {
      const blob = new Blob([new Uint8Array(BYTES).fill(3)]);
      const t = performance.now();
      await new Promise<void>((res, rej) => {
        const tx = (db.transaction as any)("p", "readwrite", { durability });
        tx.objectStore("p").put(blob, durability);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      r[`put32MiB_${durability}_ms`] = +(performance.now() - t).toFixed(1);
    }
    const t = performance.now();
    const got: Blob = await new Promise((res, rej) => {
      const q = db.transaction("p").objectStore("p").get("strict");
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    r.getBlob = got instanceof Blob && got.size === BYTES;
    r.get32MiBms = +(performance.now() - t).toFixed(1);
    db.close();
    await new Promise((res) => {
      const d = indexedDB.deleteDatabase("g-prj-probe");
      d.onsuccess = d.onerror = d.onblocked = res;
    });
  } catch (e) {
    r.error = String(e);
  }
  return r;
}

async function locks(): Promise<R> {
  const r: R = { available: typeof navigator.locks?.request === "function" };
  if (!r.available) return r;
  try {
    r.exclusiveHeldThenIfAvailableNull = await navigator.locks.request("g-prj-probe", async () =>
      navigator.locks.request("g-prj-probe", { ifAvailable: true }, async (l) => l === null),
    );
  } catch (e) {
    r.error = String(e);
  }
  return r;
}

async function run(): Promise<R> {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const result: R = {
    userAgent: navigator.userAgent,
    secureContext: isSecureContext,
    crossOriginIsolated,
    fileSystemAccess: {
      showOpenFilePicker: has(window, "showOpenFilePicker"),
      showSaveFilePicker: has(window, "showSaveFilePicker"),
      showDirectoryPicker: has(window, "showDirectoryPicker"),
      queryPermission: has(globalThis.FileSystemHandle?.prototype, "queryPermission"),
    },
    fallbacks: {
      inputFile: "files" in document.createElement("input"),
      anchorDownload: "download" in document.createElement("a"),
      webShareFiles: typeof navigator.canShare === "function",
    },
    storage: {
      persist: typeof navigator.storage?.persist === "function",
      persisted: await navigator.storage?.persisted?.().catch(() => null),
      estimateQuotaMiB: est ? Math.round((est.quota ?? 0) / 2 ** 20) : null,
      estimateUsageMiB: est ? Math.round((est.usage ?? 0) / 2 ** 20) : null,
      storageBuckets: has(navigator, "storageBuckets"),
    },
    broadcastChannel: typeof BroadcastChannel === "function",
    launchQueue: has(window, "launchQueue"),
    compression: {
      compress: (() => {
        try {
          new CompressionStream("deflate-raw");
          return true;
        } catch {
          return false;
        }
      })(),
    },
    beforeunloadEvent: "onbeforeunload" in window,
    opfs: await within(opfs(), 60_000),
    indexedDB: await within(idb(), 60_000),
    webLocks: await within(locks()),
  };
  // persist() last: in some engines it prompts or depends on engagement heuristics.
  result.persistRequest = await within(
    navigator.storage?.persist?.().catch((e) => `error: ${e}`) ?? Promise.resolve(null),
    10_000,
  );
  return result;
}

run().then(
  (r) => {
    (window as unknown as { __probe: R }).__probe = r;
    document.getElementById("out")!.textContent = JSON.stringify(r, null, 2);
  },
  (e) => {
    (window as unknown as { __probe: R }).__probe = { fatal: String(e) };
  },
);
