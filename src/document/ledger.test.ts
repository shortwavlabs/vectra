import { describe, expect, test } from "vite-plus/test";
import { ResourceLedger } from "./ledger.ts";
import { fixtureSession } from "./testing/helpers.ts";

describe("resource ledger skeleton (RFC §11.3)", () => {
  test("store bytes by owner kind, history bytes, sources and registered reporters", () => {
    const session = fixtureSession(["circle-bw", "thin_strokes-halftone"]);
    const ledger = new ResourceLedger(session);
    const store = session.store.bytes();
    let s = ledger.snapshot();
    expect(s.store).toEqual(store);
    expect(s.historyBytes).toBe(0);
    expect(s.total).toBe(store.total);
    session.dispatch({ type: "delete", ids: [session.state.orderedRootIds[1]!] });
    s = ledger.snapshot();
    expect(s.historyBytes).toBe(session.store.cost("chk_2"));
    expect(s.store.byOwnerKind.history).toBe(s.historyBytes);
    const off = ledger.register({ id: "render-worker", kind: "render-worker", bytes: () => 1234 });
    expect(() =>
      ledger.register({ id: "render-worker", kind: "render-worker", bytes: () => 0 }),
    ).toThrow();
    s = ledger.snapshot();
    expect(s.reporters).toEqual({ "render-worker": { kind: "render-worker", bytes: 1234 } });
    expect(s.total).toBe(store.total + 1234);
    off();
    expect(ledger.snapshot().reporters).toEqual({});
  });
});
