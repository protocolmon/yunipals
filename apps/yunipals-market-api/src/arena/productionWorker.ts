import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  statSync
} from "node:fs";
import { join } from "node:path";

import type { ArenaLabService } from "./service";

// Only local operators can authorize spend. There is deliberately no HTTP route
// that writes this file. Each approved job has a $1 submission ceiling in Python.
export function createArenaProductionWorker(
  root: string,
  directory: string,
  service: ArenaLabService
) {
  let active: ChildProcess | null = null;
  return {
    tick() {
      if (active) return;
      const allowlist = join(directory, "production-allowlist.json");
      if (!existsSync(allowlist)) return;
      if ((statSync(allowlist).mode & 0o077) !== 0)
        throw new Error("Production authorization must be private.");
      const ids: unknown = JSON.parse(readFileSync(allowlist, "utf8"));
      if (
        !Array.isArray(ids) ||
        ids.length > 10 ||
        ids.some((id) => typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
      )
        throw new Error("Invalid production authorization.");
      for (const id of ids as string[]) {
        const tournament = service.get(id);
        if (
          !tournament.revealedAt ||
          tournament.rulesVersion !== "arena-combat-lab-v2"
        )
          continue;
        const pack = join(directory, "jobs", id);
        const statusFile = join(pack, "public", "status.json");
        const status = existsSync(statusFile)
          ? (JSON.parse(readFileSync(statusFile, "utf8")) as { phase: string })
          : null;
        if (
          status &&
          ["validation-failed", "needs-attention", "review-ready"].includes(
            status.phase
          )
        )
          continue;
        const framesReady = ["SF1", "SF2", "FINAL"].every((match) =>
          existsSync(join(pack, "scenes", match, "first-frame.png"))
        );
        if (status?.phase === "awaiting-artwork" && !framesReady) continue;
        const log = openSync(
          join(directory, "production-worker.log"),
          "a",
          0o600
        );
        active = spawn(
          "python3",
          [
            join(root, "scripts/arena/produce.py"),
            id,
            framesReady ? "--video" : "--run"
          ],
          {
            cwd: root,
            env: { ...process.env, ARENA_LAB_STATE_DIR: directory },
            stdio: ["ignore", log, log]
          }
        );
        closeSync(log);
        active.once("error", () => {
          active = null;
        });
        active.once("exit", () => {
          active = null;
        });
        break;
      }
    }
  };
}
