// The render worker's build identity, from the same build-time constants as the compute worker
// (vite.config.ts `define`). Kept inside src/renderer so the renderer imports only itself (C8).
import { RENDER_PROTOCOL_VERSION, type RenderIdentity } from "./protocol.ts";

declare const __VECTRA_BUILD_ID__: string;

/** GeometryPacket v1 (C3); the render worker consumes its geometry sections. */
export const RENDER_PACKET_VERSION = 1;

export const RENDER_IDENTITY: RenderIdentity = Object.freeze({
  protocolVersion: RENDER_PROTOCOL_VERSION,
  buildId: __VECTRA_BUILD_ID__,
  packetVersion: RENDER_PACKET_VERSION,
});
