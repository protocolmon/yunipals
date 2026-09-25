import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
execFileSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--noEmit", "false", "--outDir", "dist"],
  { cwd: root, stdio: "inherit" }
);
copyFileSync(new URL("../src/shutdown-deadline.mjs", import.meta.url), new URL("../dist/shutdown-deadline.mjs", import.meta.url));
