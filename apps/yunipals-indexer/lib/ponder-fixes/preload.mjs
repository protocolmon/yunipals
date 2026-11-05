import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyFixes, checkRuntime, expectedFiles } from "./fixes.mjs";

export function install() {
  const targets = checkRuntime();
  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      const relative = targets.get(url);
      if (!relative) return result;
      return {
        ...result,
        source: applyFixes(
          relative,
          typeof result.source === "string"
            ? result.source
            : Buffer.from(result.source).toString("utf8")
        )
      };
    }
  });
  console.log(
    JSON.stringify({
      event: "yunipals_ponder_fixes_enabled",
      schemaVersion: 1,
      pid: process.pid,
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
      event: "yunipals_ponder_fixes_verified",
      files: expectedFiles
    })
  );
} else {
  install();
}
