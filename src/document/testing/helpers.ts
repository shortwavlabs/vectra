// TEST-ONLY helpers: sessions built from regression fixtures with the test-only adapter.
import { GeometryStore } from "../geometry-store.ts";
import type { DocLimits } from "../invariants.ts";
import { createDocument, DocumentError } from "../model.ts";
import type { PacketLimits } from "../packet-port.ts";
import { DocumentSession, type HistoryLimits } from "../session.ts";
import { FIXTURE_SCENES, fixturePacket } from "./fixtures.ts";
import { testPacketPort } from "./packet-adapter.ts";
import { parseColor } from "./synthetic.ts";

export interface TestSessionOptions {
  limits?: DocLimits;
  history?: HistoryLimits;
  packetLimits?: PacketLimits;
  now?: () => number;
  coalesceWindowMs?: number;
}

export function emptySession(o: TestSessionOptions = {}, width = 256, height = 256) {
  const store = new GeometryStore(testPacketPort, o.packetLimits ? { limits: o.packetLimits } : {});
  return new DocumentSession(store, {
    state: createDocument({ documentId: "doc-test", width, height }),
    ...o,
  });
}

/** A session holding one committed trace layer per named fixture, in order. */
export function fixtureSession(names: readonly string[], o: TestSessionOptions = {}) {
  const first = FIXTURE_SCENES.get(names[0]!)!.scene;
  const store = new GeometryStore(testPacketPort, o.packetLimits ? { limits: o.packetLimits } : {});
  const session = new DocumentSession(store, {
    state: createDocument({
      documentId: "doc-test",
      width: first.width,
      height: first.height,
      background: first.background === null ? null : parseColor(first.background),
    }),
    ...o,
  });
  for (const n of names)
    session.dispatch({ type: "commitTrace", packet: fixturePacket(n), name: n });
  return session;
}

export const errorCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof DocumentError ? e.code : `untyped:${String(e)}`;
  }
  return "ok";
};
