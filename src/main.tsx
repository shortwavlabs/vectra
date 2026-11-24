import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

// Production only: the service worker precaches this build so the engine worker can be
// recreated offline (e.g. after a cancellation). It never handles cross-origin requests.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((e: unknown) => {
    console.warn("service worker registration failed; offline recovery unavailable", e);
  });
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
