// C7 container constants shared by the container (writer and loader) and the session's
// persistability enforcement (AM-3.3), which must agree on them exactly.
import { DOCUMENT_SCHEMA_VERSION } from "../document/model.ts";

/** C7 limits table (session budget is the profile's; default 512 MiB). */
export const CONTAINER_LIMITS = Object.freeze({
  maxHeaderBytes: 2 ** 20,
  maxSections: 4096,
  maxManifestBytes: 2 ** 20, // not in C7's table; the manifest section is a few dozen bytes
  maxDocumentBytes: 64 * 2 ** 20,
  maxSourceBytes: 20 * 2 ** 20,
  sessionBudget: 512 * 2 ** 20,
});

/** The manifest section this build writes (C7). */
export const MANIFEST = Object.freeze({
  app: "vectra",
  formatVersion: 1,
  documentSchemaVersion: DOCUMENT_SCHEMA_VERSION,
  packetVersion: 1,
});
