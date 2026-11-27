/// <reference types="vite/client" />
// G-PRJ-R design prototype entry (dev server only): ?state=<name> picks a state, ?capture=1 hides
// the prototype state switcher. Prototype-only notes ("would show the file picker") go to the
// switcher, never into the product's own status words.
import { CSPProvider } from "@base-ui/react/csp-provider";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "../../../src/ui/registry/tooltip";
import { STATES, type StateName } from "./data.ts";
import { Home } from "./Home.tsx";
import { WorkspaceProto } from "./Workspace.tsx";
import "./home.css";

export interface Nav {
  state: StateName;
  /** The project the workspace shows (defaults to Great Wave). `file: null` = never saved. */
  project?: { name: string; file: string | null };
  /** The workspace opened recovered changes. */
  recovered?: boolean;
  /** The home and library show the recovery data set. */
  recovery?: boolean;
}
export type Go = (state: StateName, extra?: Omit<Nav, "state">) => void;

const params = new URLSearchParams(location.search);
const capture = params.get("capture") === "1";
const isState = (s: string | null): s is StateName => STATES.some(([n]) => n === s);
const fromUrl = (): Nav => {
  const s = new URLSearchParams(location.search).get("state");
  return { state: isState(s) ? s : "recovery" };
};

function App() {
  const [nav, setNav] = useState<Nav>(fromUrl);
  const [protoNote, setProtoNote] = useState("");
  useEffect(() => {
    const pop = () => setNav(fromUrl());
    const onNote = (e: Event) => setProtoNote((e as CustomEvent<string>).detail);
    window.addEventListener("popstate", pop);
    window.addEventListener("proto-note", onNote);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("proto-note", onNote);
    };
  }, []);
  const go: Go = (state, extra) => {
    const q = new URLSearchParams(location.search);
    q.set("state", state);
    history.pushState(null, "", `?${q}`);
    setProtoNote("");
    setNav({ state, ...extra });
  };
  const home = ["empty", "populated", "recovery", "library", "storage"].includes(nav.state);
  // Each state (and each navigation) starts fresh: the prototype keeps no data between them.
  const key = `${nav.state}:${JSON.stringify(nav)}`;
  return (
    <TooltipProvider delay={300}>
      {home ? (
        <Home key={key} state={nav.state} go={go} recovery={nav.recovery} />
      ) : (
        <WorkspaceProto
          key={key}
          state={nav.state}
          go={go}
          project={nav.project}
          recovered={nav.recovered}
        />
      )}
      {!capture && (
        <nav
          aria-label="Prototype state"
          className="fixed bottom-9 left-3 z-40 grid w-64 gap-1 rounded-md border border-dashed border-control-border bg-background p-2 text-xs shadow-md"
        >
          <label className="grid gap-1 text-muted-foreground">
            Prototype state (not part of the design)
            <select
              value={nav.state}
              onChange={(e) => go(e.target.value as StateName)}
              className="h-7 rounded-md border border-control-border bg-background px-2 text-foreground"
            >
              {STATES.map(([n, label]) => (
                <option key={n} value={n}>
                  {n}: {label}
                </option>
              ))}
            </select>
          </label>
          {protoNote && (
            <p role="status" className="text-pretty text-muted-foreground">
              Prototype: {protoNote}
            </p>
          )}
        </nav>
      )}
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CSPProvider disableStyleElements>
      <App />
    </CSPProvider>
  </StrictMode>,
);
