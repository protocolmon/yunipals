import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// SHA-256 of each unmodified Ponder 0.17.5 module these fixes apply to.
export const expectedFiles = {
  "rpc/index.js":
    "eac7d55d2ef1bdae20b671b91ff4dcb544972d7cdc41fe972e0ecf0196f45976",
  "sync-historical/index.js":
    "f9e84b78ba4e965ef856c4ff8f555bc871f3ca1c5528ad30d2398ce4b673372f"
};

const replacements = {
  // Ponder's config builder sets unused topic filters to null, but this check
  // only recognizes undefined. Every event therefore gets its own eth_getLogs
  // request, and the per-address merge below it never runs.
  "sync-historical/index.js": [1, 2, 3].map((topic) => [
    `const hasTopic${topic} = filter.topic${topic} !== undefined;`,
    `const hasTopic${topic} = filter.topic${topic} !== undefined && filter.topic${topic} !== null;`
  ]),
  // A provider admits at most floor(rpsLimit) requests in a second. Comparing
  // that whole number with 0.9 * rpsLimit can never pass for limits such as
  // 3.46, where 3 < 3.114, so the limit stays there until the next restart.
  "rpc/index.js": [
    [
      "if (count < bucket.rpsLimit * RPS_INCREASE_QUALIFIER) {",
      "if (count < Math.floor(bucket.rpsLimit) * RPS_INCREASE_QUALIFIER) {"
    ]
  ]
};

export function applyFixes(relative, source) {
  const selected = replacements[relative];
  if (!selected) throw new Error(`Unsupported Ponder fix target: ${relative}`);
  for (const [before, after] of selected) {
    if (source.split(before).length !== 2)
      throw new Error(
        "Ponder fixes do not match the pinned Ponder runtime source."
      );
    source = source.replace(before, after);
  }
  return source;
}

// Hooks see source another preload may already have transformed, so the pin is
// checked against the installed file before any application module loads.
export function checkRuntime(directory = process.cwd()) {
  const root = realpathSync(resolve(directory, "node_modules/ponder"));
  if (
    JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version !==
    "0.17.5"
  )
    throw new Error("The Ponder fixes require the pinned Ponder 0.17.5.");
  const targets = new Map();
  for (const [relative, expected] of Object.entries(expectedFiles)) {
    const path = resolve(root, "dist/esm", relative);
    const source = readFileSync(path, "utf8");
    if (createHash("sha256").update(source).digest("hex") !== expected)
      throw new Error(`Unsupported Ponder fix target: ${relative}`);
    applyFixes(relative, source);
    targets.set(pathToFileURL(path).href, relative);
  }
  return targets;
}
