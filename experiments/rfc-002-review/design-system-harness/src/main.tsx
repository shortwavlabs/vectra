import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CSPProvider } from "@base-ui/react/csp-provider";
import { App } from "./App";
import "./index.css";

// ?csp=default is the positive-control arm: Base UI is allowed to render its inline <style>
// elements, which the production style-src 'self' must block (and report).
const mitigated = new URLSearchParams(location.search).get("csp") !== "default";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {mitigated ? (
      <CSPProvider disableStyleElements>
        <App />
      </CSPProvider>
    ) : (
      <App />
    )}
  </StrictMode>,
);
