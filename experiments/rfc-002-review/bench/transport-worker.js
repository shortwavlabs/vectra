// Transport worker: holds the scene in both representations and posts the requested one.
import { clonePacket, transferList } from "./packet.mjs";
import { viewPacket } from "./common.mjs";

let json = null, packet = null;
const now = () => performance.timeOrigin + performance.now();

self.onmessage = async ({ data }) => {
  if (data.type === "load") {
    const base = data.kind === "real" ? "/scenes/real/" : "/scenes/synth/";
    json = await fetch(`${base}${data.name}.scene.json`).then((r) => r.text());
    const [man, bin] = await Promise.all([
      fetch(`/packets/${data.name}.manifest.json`).then((r) => r.json()),
      fetch(`/packets/${data.name}.bin`).then((r) => r.arrayBuffer()),
    ]);
    packet = viewPacket(man, bin);
    self.postMessage({ type: "loaded" });
    return;
  }
  // Payloads are prepared before the timestamp: only serialisation + delivery is measured.
  if (data.mode === "json-string") {
    const t = now();
    self.postMessage({ type: "payload", t, json });
  } else if (data.mode === "json-object") {
    const obj = JSON.parse(json);
    const t = now();
    self.postMessage({ type: "payload", t, obj });
  } else {
    const p = clonePacket(packet);
    const t = now();
    if (data.mode === "packet-transfer") self.postMessage({ type: "payload", t, p }, transferList(p));
    else self.postMessage({ type: "payload", t, p });
  }
};
