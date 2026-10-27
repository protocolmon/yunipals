// Public dependency resolution only; retained official modules stay unchanged.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PUBLIC_ROOT =
  "/opt/yunipals-unified/releases/6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6";
export const SOURCE_PREFIX = pathToFileURL(
  "/var/lib/yunipals-booster-launch/20261022-source008/"
).href;
const pgRoot = PUBLIC_ROOT + "/node_modules/.pnpm/pg@8.23.0/node_modules/pg";
const viemRoot =
  PUBLIC_ROOT +
  "/node_modules/.pnpm/viem@2.55.13_bufferutil@4.1.0_typescript@5.7.3_utf-8-validate@5.0.10_zod@3.24.2/node_modules/viem";
const tsxRoot =
  PUBLIC_ROOT + "/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx";
export const TSX_LOADER =
  PUBLIC_ROOT + "/apps/yunipals-market-api/node_modules/tsx/dist/loader.mjs";
export const TSX_REAL_LOADER = tsxRoot + "/dist/loader.mjs";
export const TSX_LOADER_SHA =
  "17e2a92c5f1f70065b01c65d5ee9ac260839d4fc0ea78fdbb4db7b1155ccd32f";
export const CONTEXTS = Object.freeze({
  pg: Object.freeze({
    parent: PUBLIC_ROOT + "/apps/yunipals-market-api/package.json",
    package: pgRoot + "/package.json",
    require: pgRoot + "/lib/index.js",
    import: pgRoot + "/esm/index.mjs"
  }),
  viem: Object.freeze({
    parent: PUBLIC_ROOT + "/apps/yunipals-indexer/package.json",
    package: viemRoot + "/package.json",
    require: viemRoot + "/_cjs/index.js",
    import: viemRoot + "/_esm/index.js"
  })
});
export const PUBLIC_PINS = Object.freeze({
  [CONTEXTS.pg.parent]:
    "fc7fb879764842fc63b7692fd1d515a0dccf7927412a3a90b3cfb60d76d109dd",
  [CONTEXTS.viem.parent]:
    "bd4e6ad829f418c9ebc43350861b075e2352e59a348a829baba4f8fee624134b",
  [CONTEXTS.pg.package]:
    "e42dd36cba6e9dd8dbb6f773a2f7be8a8c3c273e18b155e42e75961a4cb8bc28",
  [CONTEXTS.pg.require]:
    "3fad6e6d3d976edbabe0cbc9e1d39f4340bcb719bbbb186a0d3a24f3dbd4a94c",
  [CONTEXTS.pg.import]:
    "5ef4d06556eeb775987759c2c09229dca2139421ee40e819b566612db2b4a8dc",
  [CONTEXTS.viem.package]:
    "8b5112e95226a77c4a65313036c219793b5a02c99592e21b11b7f52580bc3119",
  [CONTEXTS.viem.require]:
    "c08dcb5b68d51f58af1ffd79e0bb7f9a1856db88c12c0c4934a3f2ee6822873b",
  [CONTEXTS.viem.import]:
    "ea32975364e9f2d599b10639d81985ec6a3ed87f6942fe0cb73b1bf738959057",
  [tsxRoot + "/package.json"]:
    "ab5f14c4251638844ade3905d3cfc52fc1c833644694d655a05f6d0ca746b83c",
  [TSX_REAL_LOADER]: TSX_LOADER_SHA
});

export function pinPublicFile(file, pin) {
  if (realpathSync(file) !== file)
    throw Error("exact_public_dependency_path_required");
  for (let item = file; ; item = path.dirname(item)) {
    const st = lstatSync(item);
    if (st.uid !== 0 || st.isSymbolicLink() || st.mode & 0o022)
      throw Error("protected_public_dependency_required");
    if (item === path.dirname(item)) break;
  }
  const before = lstatSync(file);
  if (!before.isFile() || before.size > 2097152)
    throw Error("bounded_public_dependency_required");
  const bytes = readFileSync(file);
  const after = lstatSync(file);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mtimeMs !== after.mtimeMs ||
    before.size !== after.size ||
    createHash("sha256").update(bytes).digest("hex") !== pin
  )
    throw Error("exact_public_dependency_bytes_required");
}

export function qualifyPublicContext(check = pinPublicFile) {
  for (const [file, pin] of Object.entries(PUBLIC_PINS)) check(file, pin);
  if (realpathSync(TSX_LOADER) !== TSX_REAL_LOADER)
    throw Error("exact_public_tsx_loader_required");
}

export function publicResolver(
  check = pinPublicFile,
  requireAt = createRequire
) {
  return (specifier, context, nextResolve) => {
    const selected = Object.hasOwn(CONTEXTS, specifier)
      ? CONTEXTS[specifier]
      : null;
    if (!selected || !context.parentURL?.startsWith(SOURCE_PREFIX))
      return nextResolve(specifier, context);
    check(selected.parent, PUBLIC_PINS[selected.parent]);
    check(selected.package, PUBLIC_PINS[selected.package]);
    const requiring = context.conditions?.includes("require") === true;
    const expected = selected[requiring ? "require" : "import"];
    const parentURL = pathToFileURL(selected.parent).href;
    // Node's synchronous CJS resolver retains createRequire's original paths
    // when only parentURL changes. A fixed public createRequire preserves its
    // normal require conditions; ESM retains nextResolve's import conditions.
    const requested = requiring
      ? pathToFileURL(requireAt(parentURL).resolve(specifier)).href
      : specifier;
    const resolved = nextResolve(requested, { ...context, parentURL });
    if (resolved.url !== pathToFileURL(expected).href)
      throw Error("exact_public_dependency_entry_required");
    check(expected, PUBLIC_PINS[expected]);
    return resolved;
  };
}

export function installPublicContext() {
  qualifyPublicContext();
  return registerHooks({ resolve: publicResolver() });
}

if (process.env.YUNIPALS_OBSERVER_PUBLIC_CONTEXT === "public6e-v1")
  installPublicContext();
