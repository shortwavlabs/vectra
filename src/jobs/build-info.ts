// Build identity compiled into the page and every worker of one build (vite.config.ts `define`).
// The worker reports it in `ready`; the scheduler refuses a worker from any other build (C5).
import { PACKET_VERSION } from "../geometry/packet/types.ts";
import { type BuildIdentity, PROTOCOL_VERSION } from "./protocol.ts";

declare const __VECTRA_BUILD_ID__: string;
declare const __VECTRA_ENGINE_VERSION__: string;

export const BUILD_IDENTITY: BuildIdentity = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  buildId: __VECTRA_BUILD_ID__,
  engineVersion: __VECTRA_ENGINE_VERSION__,
  packetVersion: PACKET_VERSION,
});
