// Build-aware offline status (G-JOB single-build sessions), shared by the workbench
// (index.html) and the workspace (workspace.html). The page is "offline ready" only when its
// controlling service worker caches this page's own build. A worker of another build can claim
// a page on first install, when a deploy raced the page load. A waiting update is reported
// separately; it never forces a reload.
import { BUILD_IDENTITY } from "./build-info.ts";

export interface ControllerBuild {
  readonly version: string;
  readonly buildId: string | null;
}

export interface OfflineStatus {
  /** The controlling worker caches this page's build: a reload works offline. */
  readonly ready: boolean;
  /** A worker of another build controls this page. */
  readonly mismatch: boolean;
  /** A newer worker is installed; it takes over once every tab of the old one has closed. */
  readonly updateWaiting: boolean;
  readonly controller: ControllerBuild | null;
}

/** The controlling service worker's version and build ID, or null when the page is uncontrolled. */
export function controllerBuild(): Promise<ControllerBuild | null> {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ version: "unknown", buildId: null }), 5000);
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "vectra-sw-version") return;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      resolve({ version: String(e.data.version), buildId: e.data.buildId ?? null });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    controller.postMessage("vectra-sw-version");
  });
}

/** Reports the offline status now and whenever the service worker changes; returns a stop. */
export function watchOfflineStatus(onChange: (status: OfflineStatus) => void): () => void {
  const sw = navigator.serviceWorker;
  if (!sw) return () => {};
  let live = true;
  let stop = () => {};
  void sw.ready.then((reg) => {
    if (!live) return;
    const update = async () => {
      const updateWaiting = reg.waiting !== null;
      const controller = await controllerBuild();
      if (!live) return;
      const ready = controller !== null && controller.buildId === BUILD_IDENTITY.buildId;
      onChange({ ready, mismatch: controller !== null && !ready, updateWaiting, controller });
    };
    const onChangeEvent = () => void update();
    const onFound = () => reg.installing?.addEventListener("statechange", onChangeEvent);
    sw.addEventListener("controllerchange", onChangeEvent);
    reg.addEventListener("updatefound", onFound);
    stop = () => {
      sw.removeEventListener("controllerchange", onChangeEvent);
      reg.removeEventListener("updatefound", onFound);
    };
    void update();
  });
  return () => {
    live = false;
    stop();
  };
}
