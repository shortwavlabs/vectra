import init, { engineVersion } from "../../packages/vector-engine-wasm/pkg/vector_engine_wasm.js";

await init();
postMessage(engineVersion());
