import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const expectedFiles = {
  "internal/logger.js":
    "091a9d507dda3814f044d526e0476dd8849041f8b622077abc2e9e16862ca8cd",
  "runtime/realtime.js":
    "41cf28ac504b44a904691417324c363ec8a561cc4e897134d5286f69b59b04d8",
  "rpc/index.js":
    "eac7d55d2ef1bdae20b671b91ff4dcb544972d7cdc41fe972e0ecf0196f45976"
};

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error(
      "Profiling instrumentation does not match the pinned Ponder runtime."
    );
  return source.replace(before, after);
}

export function instrument(relative, source) {
  if (
    createHash("sha256").update(source).digest("hex") !==
    expectedFiles[relative]
  )
    throw new Error(`Unsupported Ponder profiling target: ${relative}`);
  const prefix = `import { profiler as __yunipalsProfile } from ${JSON.stringify(new URL("./runtime.mjs", import.meta.url).href)};\n`;
  if (relative === "internal/logger.js") {
    for (const level of ["trace", "debug", "info", "warn", "error"])
      source = replaceOnce(
        source,
        `${level}(options, printKeys) {`,
        `${level}(options, printKeys) {\n                __yunipalsProfile.log(options);`
      );
  } else if (relative === "runtime/realtime.js") {
    source = replaceOnce(
      source,
      "callback({ block, blockCallback: pwr.resolve, endClock });",
      "const profileHead = __yunipalsProfile.enqueue(params.chain.id, block);\n            callback({ block, blockCallback: pwr.resolve, endClock, profileHead });"
    );
    source = replaceOnce(
      source,
      "for await (const { block, blockCallback, endClock } of generator) {",
      "for await (const { block, blockCallback, endClock, profileHead } of generator) {\n        __yunipalsProfile.dequeue(profileHead);"
    );
    source = replaceOnce(
      source,
      "blockCallback(isAccepted);",
      "__yunipalsProfile.complete(profileHead, isAccepted);\n            blockCallback(isAccepted);"
    );
  } else if (relative === "rpc/index.js") {
    source = replaceOnce(
      source,
      "worker: async ({ body, context }) => {",
      "worker: async ({ body, context, profileRpc }) => {\n            __yunipalsProfile.rpcStart(profileRpc);"
    );
    source = replaceOnce(
      source,
      "request: (parameters, context) => queue.add({ body: parameters, context }),",
      "request: (parameters, context) => __yunipalsProfile.rpc(chain.id, parameters, (profileRpc) => queue.add({ body: parameters, context, profileRpc })),"
    );
  }
  return prefix + source;
}

export function checkRuntime(directory = process.cwd()) {
  const root = realpathSync(resolve(directory, "node_modules/ponder"));
  if (
    JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version !==
    "0.17.5"
  )
    throw new Error(
      "The profiler requires the qualified Ponder 0.17.5 runtime."
    );
  const targets = new Map();
  for (const relative of Object.keys(expectedFiles)) {
    const path = resolve(root, "dist/esm", relative);
    // Check every transform before allowing any application module to load.
    instrument(relative, readFileSync(path, "utf8"));
    targets.set(pathToFileURL(path).href, relative);
  }
  return targets;
}
