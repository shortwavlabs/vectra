// TEST-ONLY regression fixture loader (vitest/Vite only: uses import.meta.glob).
import { encodeScene, type SceneV1 } from "./synthetic.ts";

const raw = import.meta.glob<string>("./fixtures/*.scene.json.raw", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Procedural regression scenes, keyed by case name (e.g. "circle-bw"). */
export const FIXTURE_SCENES: ReadonlyMap<string, { text: string; scene: SceneV1 }> = new Map(
  Object.entries(raw)
    .map(([path, text]) => {
      const name = path.replace("./fixtures/", "").replace(".scene.json.raw", "");
      return [name, { text, scene: JSON.parse(text) as SceneV1 }] as const;
    })
    .sort(([a], [b]) => (a < b ? -1 : 1)),
);

export const fixturePacket = (name: string) => {
  const f = FIXTURE_SCENES.get(name);
  if (!f) throw new Error(`unknown fixture ${name}`);
  return encodeScene(f.scene);
};
