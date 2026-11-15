import type { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { PortalSourceError } from "../lib/portals/errors.js";
import { comparePortalSources } from "../lib/unified/portal-parity.js";
import type { SharedPortalLedger } from "../lib/portals/shared-ledger.js";

it("compares a frozen legacy snapshot while both readers advance", async () => {
  const hash = `0x${"ab".repeat(32)}`;
  const competition = `0x${"12".repeat(20)}`;
  let legacyHead = 10;
  let frozen: number | undefined;
  let checks = 0;
  let released = false;
  const query = async (sql: string) => {
    if (sql.startsWith("BEGIN")) frozen = legacyHead;
    if (sql.includes("block_number::text AS block"))
      return {
        rows: [
          { block: String(frozen), hash, competition, generation: "fixture" }
        ],
        rowCount: 1
      };
    return { rows: [], rowCount: 0 };
  };
  const legacy = {
    connect: async () => ({
      query,
      release: () => {
        released = true;
      }
    })
  } as unknown as Pool;
  const shared = {
    deployment: "fixture",
    db: { query },
    cursor: async () => {
      checks++;
      // The live legacy scanner advances during the shared reader's first read.
      legacyHead = 11;
      return { block: checks === 1 ? "9" : "10", hash, competition };
    },
    transactionSnapshot: async (read: () => Promise<unknown>) => read(),
    sourceIdentity: () => ({}),
    chain: { client: { getBlock: async () => ({ hash }) } }
  } as unknown as SharedPortalLedger;
  const report = await comparePortalSources(legacy, shared);
  expect(report.block).toBe("10");
  expect(legacyHead).toBe(11);
  expect(report.matches).toBe(true);
  expect(report.comparisons).toHaveLength(8);
  expect(checks).toBeGreaterThanOrEqual(3);
  expect(released).toBe(true);
});

it("retains the source readiness reason when the parity coverage wait expires", async () => {
  const unavailable = new PortalSourceError(
    "source_unavailable",
    "Observer is catching up."
  );
  const query = async (sql: string) => ({
    rows: sql.includes("block_number::text AS block")
      ? [{ block: "10", hash: "fixture", competition: "fixture" }]
      : [],
    rowCount: 0
  });
  const legacy = {
    connect: async () => ({ query, release() {} })
  } as unknown as Pool;
  const shared = {
    deployment: "fixture",
    cursor: async () => {
      throw unavailable;
    }
  } as unknown as SharedPortalLedger;
  const time = vi
    .spyOn(Date, "now")
    .mockReturnValueOnce(0)
    .mockReturnValue(30_000);
  try {
    await expect(comparePortalSources(legacy, shared)).rejects.toMatchObject({
      code: "source_unavailable",
      cause: unavailable,
      message: "Portal parity coverage wait timed out: Observer is catching up."
    });
  } finally {
    time.mockRestore();
  }
});
