// Entry of the workspace page (workspace.html). The P0 workbench (index.html) is unchanged.
import { CSPProvider } from "@base-ui/react/csp-provider";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../ui/styles.css";
import { Workspace } from "./Workspace.tsx";

// Production only: the same service worker as the workbench (precaches this build, so the
// page and its workers load offline). It never handles cross-origin requests.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((e: unknown) => {
    console.warn("service worker registration failed; offline use unavailable", e);
  });
}

// Strict CSP (style-src 'self'): Base UI must not inject <style> elements; the one rule it
// would inject is owned in src/ui/styles.css (TD-UI-001). `?csp=default` drops the provider:
// a diagnostic for the CSP regression test's positive control only. It cannot weaken the
// policy; it only makes Base UI attempt the inline style, which the browser blocks.
const mitigated = new URLSearchParams(location.search).get("csp") !== "default";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    {mitigated ? (
      <CSPProvider disableStyleElements>
        <Workspace />
      </CSPProvider>
    ) : (
      <Workspace />
    )}
  </StrictMode>,
);
