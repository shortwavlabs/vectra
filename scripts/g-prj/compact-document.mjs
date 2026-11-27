// G-PRJ-R research prototype (not production): a lossless "defaults omitted" encoding of the
// canonical document JSON (C10 schema v1), to measure what compact encoding would save before
// any limit is raised. Production would need a C10/C7 amendment (G-PRJ-0); this file is only
// used by scripts/g-prj/persistence-limits.mjs.
//
// Omitted when equal to the default, restored on decode:
//   node.id (equal to its key) · node.name "" · node.visible true · node.locked false ·
//   node.localTransform [1,0,0,1,0,0]
// Everything else, including styles, palette, provenance and source assets, is unchanged.

const IDENTITY = [1, 0, 0, 1, 0, 0];
const isIdentity = (m) =>
  Array.isArray(m) && m.length === 6 && m.every((v, i) => v === IDENTITY[i]);

export function encodeCompact(doc) {
  const nodes = {};
  for (const [key, n] of Object.entries(doc.nodesById)) {
    const c = { ...n };
    if (c.id === key) delete c.id;
    if (c.name === "") delete c.name;
    if (c.visible === true) delete c.visible;
    if (c.locked === false) delete c.locked;
    if (isIdentity(c.localTransform)) delete c.localTransform;
    nodes[key] = c;
  }
  return { ...doc, nodesById: nodes };
}

export function decodeCompact(doc) {
  const nodes = {};
  for (const [key, c] of Object.entries(doc.nodesById))
    nodes[key] = {
      ...c,
      id: c.id ?? key,
      name: c.name ?? "",
      visible: c.visible ?? true,
      locked: c.locked ?? false,
      localTransform: c.localTransform ?? [...IDENTITY],
    };
  return { ...doc, nodesById: nodes };
}
