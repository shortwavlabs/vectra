import { describe, expect, test } from "vite-plus/test";
import {
  CancelledError,
  JobError,
  VectorizerClient,
  type WorkerLike,
} from "../../src/vectorization/client.ts";
import type { WorkerRequest, WorkerResponse } from "../../src/workers/protocol.ts";
import type { TraceRequest } from "../../src/vectorization/types.ts";

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike["onmessage"] = null;
  onerror: WorkerLike["onerror"] = null;
  onmessageerror: WorkerLike["onmessageerror"] = null;
  sent: { message: WorkerRequest; transfer: Transferable[] }[] = [];
  terminated = false;
  constructor() {
    queueMicrotask(() =>
      this.emit({ type: "ready", engineVersion: "0.0.0", initMs: 1, memoryBytes: 1 }),
    );
  }
  postMessage(message: WorkerRequest, transfer: Transferable[]) {
    this.sent.push({ message, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  emit(msg: WorkerResponse) {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>);
  }
  result(jobId: number, memoryBytes = 1): WorkerResponse {
    return {
      type: "trace-result",
      jobId,
      revision: 1,
      sceneJson: "{}",
      svg: "<svg/>",
      metrics: {} as never,
      warnings: [],
      timings: { wasmCallMs: 1, svgMs: 1, parseMs: 1 },
      memoryBytes,
    };
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const request = {
  presetVersion: 1,
  seed: 0,
  maxPixels: 100,
  maxAnchors: 100,
  settings: { mode: "bw" },
} as unknown as TraceRequest;

function setup(recycleAboveBytes?: number) {
  const workers: FakeWorker[] = [];
  const client = new VectorizerClient({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    recycleAboveBytes,
  });
  const job = (revision = 1) =>
    client.trace({ rgba: new ArrayBuffer(16), width: 2, height: 2, revision }, request);
  return { client, workers, job };
}

describe("VectorizerClient", () => {
  test("transfers the RGBA buffer and resolves the matching job", async () => {
    const { workers, job } = setup();
    const p = job();
    await flush();
    const sent = workers[0]!.sent[0]!;
    expect(sent.message.type).toBe("trace");
    expect(sent.transfer).toHaveLength(1);
    expect(sent.transfer[0]).toBe((sent.message as Extract<WorkerRequest, { type: "trace" }>).rgba);
    workers[0]!.emit(workers[0]!.result(sent.message.jobId));
    await expect(p).resolves.toMatchObject({ jobId: sent.message.jobId, svg: "<svg/>" });
  });

  test("a newer trace cancels the in-flight one by terminating its worker", async () => {
    const { client, workers, job } = setup();
    const a = job(1);
    await flush();
    const b = job(2);
    await expect(a).rejects.toBeInstanceOf(CancelledError);
    expect(workers[0]!.terminated).toBe(true);
    await flush();
    const jobB = workers[1]!.sent[0]!.message.jobId;
    workers[1]!.emit(workers[1]!.result(jobB));
    await expect(b).resolves.toMatchObject({ jobId: jobB });
    expect(client.stats.workersCreated).toBe(2);
  });

  test("results carrying another jobId are dropped, never resolving the current job", async () => {
    const { client, workers, job } = setup();
    const p = job();
    await flush();
    const id = workers[0]!.sent[0]!.message.jobId;
    workers[0]!.emit(workers[0]!.result(id - 1));
    expect(client.stats.staleMessagesDropped).toBe(1);
    expect(client.busy).toBe(true);
    workers[0]!.emit(workers[0]!.result(id));
    await expect(p).resolves.toMatchObject({ jobId: id });
  });

  test("cancel() rejects immediately, terminates, and the next job gets a fresh worker", async () => {
    const { client, workers, job } = setup();
    const p = job();
    await flush();
    expect(client.cancel()).toBe(true);
    expect(client.busy).toBe(false);
    await expect(p).rejects.toBeInstanceOf(CancelledError);
    expect(workers[0]!.terminated).toBe(true);
    expect(client.cancel()).toBe(false);
    const q = job();
    await flush();
    workers[1]!.emit(workers[1]!.result(workers[1]!.sent[0]!.message.jobId));
    await expect(q).resolves.toBeTruthy();
  });

  test("cancelling while the worker is still starting never posts the job", async () => {
    const { client, workers, job } = setup();
    const p = job();
    client.cancel();
    await expect(p).rejects.toBeInstanceOf(CancelledError);
    await flush();
    expect(workers[0]!.sent).toHaveLength(0);
  });

  test("worker crash rejects the job and recovers on the next job", async () => {
    const { client, workers, job } = setup();
    const p = job();
    await flush();
    workers[0]!.onerror?.({ message: "boom", preventDefault() {} } as ErrorEvent);
    await expect(p).rejects.toMatchObject({ code: "worker_crashed" });
    expect(workers[0]!.terminated).toBe(true);
    const q = job();
    await flush();
    workers[1]!.emit(workers[1]!.result(workers[1]!.sent[0]!.message.jobId));
    await expect(q).resolves.toBeTruthy();
    expect(client.stats.workersCreated).toBe(2);
  });

  test("engine errors keep the worker; fatal aborts discard it", async () => {
    const { workers, job } = setup();
    const p = job();
    await flush();
    workers[0]!.emit({
      type: "error",
      jobId: workers[0]!.sent[0]!.message.jobId,
      code: "invalid_params",
      message: "x",
      fatal: false,
    });
    await expect(p).rejects.toEqual(new JobError("invalid_params", "x"));
    expect(workers[0]!.terminated).toBe(false);
    const q = job();
    await flush();
    workers[0]!.emit({
      type: "error",
      jobId: workers[0]!.sent[1]!.message.jobId,
      code: "wasm_abort",
      message: "unreachable",
      fatal: true,
    });
    await expect(q).rejects.toMatchObject({ code: "wasm_abort" });
    expect(workers[0]!.terminated).toBe(true);
  });

  test("worker is recycled when WASM memory exceeds the threshold", async () => {
    const { client, workers, job } = setup(1000);
    const p = job();
    await flush();
    workers[0]!.emit(workers[0]!.result(workers[0]!.sent[0]!.message.jobId, 5000));
    await p;
    expect(workers[0]!.terminated).toBe(true);
    expect(client.stats.terminations).toBe(1);
  });

  test("PDF export refuses to interrupt a running trace", async () => {
    const { client, job } = setup();
    void job().catch(() => {});
    await expect(client.exportPdf("{}", { width: 10, unit: "mm" })).rejects.toMatchObject({
      code: "busy",
    });
    client.dispose();
  });
});
