/// <reference types="vite/client" />
// Synthetic demonstration data for the G-PRJ-R prototype: project names, times, sizes and states
// are invented; the thumbnails are the licensed fixture traces in docs/research/g-prj/mockups/
// thumbs (public-domain Hokusai and Talbot traces, procedural renderer fixtures). One module feeds
// the tiles, the storage dialog and every status word, so the figures add up and the three
// persistence tiers (file, this browser, recovery) never share a word.
import greatWave from "../../../docs/research/g-prj/mockups/thumbs/great-wave.webp";
import layers from "../../../docs/research/g-prj/mockups/thumbs/layers.webp";
import library from "../../../docs/research/g-prj/mockups/thumbs/library.webp";
import mosaic from "../../../docs/research/g-prj/mockups/thumbs/mosaic.webp";
import ring from "../../../docs/research/g-prj/mockups/thumbs/ring.webp";
import rings from "../../../docs/research/g-prj/mockups/thumbs/rings.webp";
import strokes from "../../../docs/research/g-prj/mockups/thumbs/strokes.webp";

export const STATES = [
  ["empty", "First launch, no projects"],
  ["populated", "Project home"],
  ["recovery", "Project home with recovery"],
  ["recovery-other", "Recovery for another project"],
  ["library", "All projects"],
  ["storage", "Projects and storage"],
  ["workspace", "Workspace project controls"],
  ["unsaved", "Unsaved changes before Open"],
  ["history-budget", "Edit too large for undo"],
  ["conflict", "File changed on disk"],
  ["save-failed", "Save failed"],
  ["download-saved", "Save as a download (Firefox, Safari)"],
  ["workspace-recovery-kept", "Opened last save; recovery kept"],
] as const;
export type StateName = (typeof STATES)[number][0];

/** Where the project's bytes live. A recovery snapshot is never a location (Project.recovery). */
export type Backing =
  | { kind: "file"; file: string } // saved to a .vectra the artist owns (Chromium file handle)
  | { kind: "browser" } // only in this browser's storage, no file copy yet
  | { kind: "unavailable"; file: string }; // the file was moved, or the permission expired

export interface Project {
  id: string;
  name: string;
  /** The project as last saved (what the tile shows; a snapshot is never "the project"). */
  thumb: string;
  edited: string;
  /** The last explicit save (Save, Save As, Save to this browser). */
  saved: string;
  /** Sort key: minutes since the last edit. */
  age: number;
  backing: Backing;
  /** Bytes kept in this browser's storage (a library copy), if any. */
  stored?: number;
  /** An unsaved-changes snapshot (recovery data) with its own thumbnail; never the project. */
  recovery?: { when: string; thumb: string; bytes: number; expires: string };
  size: string;
}

const MB = 1_000_000;

export const GREAT_WAVE = "Great Wave — limited palette";
export const GREAT_WAVE_FILE = "great-wave.vectra";
export const LAST_SAVED = "yesterday at 18:40";

export function projects(withRecovery: boolean): Project[] {
  return [
    {
      id: "wave",
      name: GREAT_WAVE,
      thumb: greatWave,
      edited: withRecovery ? "12 min ago" : "2 hours ago",
      saved: withRecovery ? LAST_SAVED : "2 hours ago",
      age: withRecovery ? 12 : 120,
      backing: { kind: "file", file: GREAT_WAVE_FILE },
      stored: 3.4 * MB,
      size: "640 × 430 px · 1,613 paths · 2 layers",
      // Only one Great Wave thumbnail exists, so both versions show it; the caption says which.
      ...(withRecovery && {
        recovery: { when: "12 min ago", thumb: greatWave, bytes: 3.6 * MB, expires: "Dec 10" },
      }),
    },
    {
      id: "library",
      name: "Scene in a Library — halftone",
      thumb: library,
      edited: "yesterday",
      saved: "yesterday",
      age: 1_440,
      backing: { kind: "file", file: "library-halftone.vectra" },
      size: "640 × 510 px · 9,850 paths · 1 layer",
    },
    {
      id: "ring",
      name: "Ring study",
      thumb: ring,
      edited: "Nov 23",
      saved: "Nov 23",
      age: 4_320,
      backing: { kind: "browser" },
      stored: 0.4 * MB,
      size: "256 × 256 px · 2 paths · 1 layer",
    },
    {
      // Two real fixture thumbnails: the last save (the rings) and the snapshot (rings plus the
      // circle layer added since).
      id: "poster",
      name: "Poster layers",
      thumb: rings,
      edited: "Nov 22",
      saved: "Nov 20",
      age: 5_760,
      backing: { kind: "file", file: "poster-layers.vectra" },
      stored: 1.2 * MB,
      size: "256 × 256 px · 7 paths · 2 layers",
      recovery: { when: "Nov 22", thumb: layers, bytes: 1.1 * MB, expires: "Dec 6" },
    },
    {
      id: "strokes",
      name: "Thin strokes test",
      thumb: strokes,
      edited: "Nov 19",
      saved: "Nov 19",
      age: 10_080,
      backing: { kind: "unavailable", file: "thin-strokes.vectra" },
      size: "256 × 256 px · 40 paths · 1 layer",
    },
    {
      id: "mosaic",
      name: "Mosaic mark",
      thumb: mosaic,
      edited: "Nov 3",
      saved: "Nov 3",
      age: 33_120,
      backing: { kind: "browser" },
      stored: 0.2 * MB,
      size: "256 × 256 px · 3 paths · 1 layer",
    },
    {
      id: "layer-test",
      name: "Layer test",
      thumb: layers,
      edited: "Oct 28",
      saved: "Oct 28",
      age: 41_760,
      backing: { kind: "file", file: "layer-test.vectra" },
      size: "256 × 256 px · 7 paths · 2 layers",
    },
  ];
}

export const mb = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;

/** One total: projects plus recovery data (thumbnails count with their project). */
export function storageTotals(list: Project[]) {
  const stored = list.reduce((s, p) => s + (p.stored ?? 0), 0);
  const recovery = list.reduce((s, p) => s + (p.recovery?.bytes ?? 0), 0);
  return { stored, recovery, total: stored + recovery };
}

/** The file state in words, short (tiles) and long (menus, the storage dialog). */
export function backingWords(p: Project): { short: string; long: string } {
  const b = p.backing;
  if (b.kind === "file")
    return {
      short: `Saved to ${b.file}`,
      long: p.stored
        ? `Saved to ${b.file}; a copy is also kept in this browser.`
        : `Saved to ${b.file}. Browsers share the file name with Vectra, not its folder.`,
    };
  if (b.kind === "unavailable")
    return {
      short: "File unavailable",
      long: `${b.file} was moved or renamed, or this browser’s permission to open it expired.`,
    };
  return {
    short: "No file copy yet",
    long: "Kept only in this browser, with no file copy yet. Clearing browser data deletes it.",
  };
}

export const fileOf = (x: Project) => (x.backing.kind === "browser" ? null : x.backing.file);

export const fileSlug = (name: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "untitled"
  }.vectra`;

/** What the workspace needs to show an opened project in its own words. */
export interface OpenProject {
  name: string;
  /** null: no file yet (browser-only, or never saved). */
  file: string | null;
  where: "file" | "browser" | "none";
  saved: string;
  recoveryWhen?: string;
}

export const toOpen = (x: Project): OpenProject => ({
  name: x.name,
  file: fileOf(x),
  where: x.backing.kind === "browser" ? "browser" : "file",
  saved: x.saved,
  recoveryWhen: x.recovery?.when,
});

export const NEW_PROJECT: OpenProject = {
  name: "Untitled project",
  file: null,
  where: "none",
  saved: "",
};

/** Prototype flags: ?engine=safari (Safari-only notes), ?storage=full (nearly-full storage). */
const flags = new URLSearchParams(location.search);
export const SAFARI = flags.get("engine") === "safari";
export const STORAGE_FULL = flags.get("storage") === "full";
