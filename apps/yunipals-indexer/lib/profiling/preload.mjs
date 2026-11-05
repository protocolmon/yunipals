import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { profiler } from "./runtime.mjs";
import { checkRuntime, expectedFiles, instrument } from "./instrumentation.mjs";

export function install() {
  const targets = checkRuntime();
  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      const relative = targets.get(url);
      if (!relative) return result;
      return {
        ...result,
        source: instrument(
          relative,
          typeof result.source === "string"
            ? result.source
            : Buffer.from(result.source).toString("utf8")
        )
      };
    }
  });
  profiler.start();
  process.once("exit", () => profiler.stop());
  console.log(
    JSON.stringify({
      event: "yunipals_indexer_profile_enabled",
      schemaVersion: 1,
      pid: process.pid,
      intervalMs: 30000,
      files: expectedFiles
    })
  );
}

const direct =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check")
    throw new Error(
      "Use node preload.mjs --check from the indexer directory, or load it with --import."
    );
  checkRuntime();
  console.log(
    JSON.stringify({
      event: "yunipals_indexer_profile_verified",
      files: expectedFiles
    })
  );
} else {
  install();
}
