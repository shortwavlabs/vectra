// G-PRJ-R probe worker: OPFS synchronous access handles exist only in dedicated workers.
self.onmessage = async (e: MessageEvent<{ bytes: number }>) => {
  const r: Record<string, unknown> = {};
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle("g-prj-probe-sync.bin", { create: true });
    r.syncAccessHandle =
      typeof (fh as unknown as { createSyncAccessHandle?: unknown }).createSyncAccessHandle ===
      "function";
    if (r.syncAccessHandle) {
      const h = await (
        fh as unknown as { createSyncAccessHandle(): Promise<any> }
      ).createSyncAccessHandle();
      const data = new Uint8Array(e.data.bytes).fill(7);
      const t0 = performance.now();
      h.truncate(0);
      h.write(data, { at: 0 });
      h.flush();
      r.syncWriteMs = +(performance.now() - t0).toFixed(1);
      r.syncSize = h.getSize();
      h.close();
    }
    r.workerCreateWritable =
      typeof (fh as unknown as { createWritable?: unknown }).createWritable === "function";
    await root.removeEntry("g-prj-probe-sync.bin");
  } catch (err) {
    r.error = String(err);
  }
  (self as unknown as Worker).postMessage(r);
};
