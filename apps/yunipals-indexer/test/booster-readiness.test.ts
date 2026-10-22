import { describe, expect, it } from "vitest";
import { boosterReadiness } from "../lib/boosters/readiness.js";
const encode = (chain: number, block = 140, suffix = "9".repeat(33)) =>
  "1800000000" + String(chain).padStart(16, "0") + String(block).padStart(16, "0") + suffix;
const current = () => ({
  runtime: { version: "6", is_dev: 0, is_locked: 1, is_ready: 1, build_id: "base-only", heartbeat_at: 1800000000000 },
  checkpoint: encode(8453), observedAtMs: "1800000000000", requestsPaused: false,
  lastBoosterEvent: null as { block: string; blockHash: string; timestamp: string } | null
});
async function read(row: ReturnType<typeof current>) {
  return boosterReadiness({ query: async () => ({ rows: [row] }) } as never, "launch", "engine");
}
describe("booster scan readiness", () => {
  it("proves a quiet Base scan without requiring a recent booster event", async () => {
    const row = current();
    const result = await read(row);
    expect(result).toMatchObject({ ready: true, indexedBlock: "140", indexedBlockHash: null, lastBoosterEvent: null });
    row.lastBoosterEvent = { block: "123", blockHash: `0x${"ab".repeat(32)}`, timestamp: "1700000000" };
    expect(await read(row)).toMatchObject({ ready: true, indexedBlock: "140", indexedBlockHash: null, lastBoosterEvent: row.lastBoosterEvent });
  });
  it("requires the matching live normal Ponder runtime and recent scan", async () => {
    for (const field of ["is_locked", "is_ready"] as const) {
      const row = current(); row.runtime[field] = 0;
      expect((await read(row)).ready).toBe(false);
    }
    const stale = current(); stale.runtime.heartbeat_at -= 180001;
    expect((await read(stale)).ready).toBe(false);
    const stopped = current(); stopped.observedAtMs = "1800000180001"; stopped.runtime.heartbeat_at = 1800000180001;
    expect((await read(stopped)).ready).toBe(false);
  });
  it("rejects malformed/other-chain checkpoints and handles partial blocks", async () => {
    for (const checkpoint of ["garbage", encode(1), "0".repeat(75)]) {
      const row = current(); row.checkpoint = checkpoint;
      expect((await read(row)).ready).toBe(false);
    }
    const partial = current(); partial.checkpoint = encode(8453, 140, "0".repeat(33));
    expect(await read(partial)).toMatchObject({ ready: true, indexedBlock: "139" });
  });
});
