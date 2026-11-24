import { useEffect, useState } from "react";

export function App() {
  const [version, setVersion] = useState("loading…");
  useEffect(() => {
    const worker = new Worker(new URL("./workers/vectorize.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<string>) => setVersion(e.data);
    worker.onerror = (e) => setVersion(`worker error: ${e.message}`);
    return () => worker.terminate();
  }, []);
  return (
    <main>
      <h1>Vectra P0 workbench</h1>
      <p data-testid="engine-version">engine {version}</p>
    </main>
  );
}
