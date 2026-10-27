import assert from "node:assert/strict";
import type { Pool } from "pg";
import type { Address, Hex } from "viem";

export const productionRulesHash =
  "0x46a4dc89a248047d27c6b02d208c5d2866e843280ef2803294384850edb06c80";
export const hash = (character: string) => `0x${character.repeat(64)}` as Hex;
export const wallet = `0x${"a".repeat(40)}` as Address;
export const otherWallet = `0x${"b".repeat(40)}` as Address;
export const contract = `0x${"c".repeat(40)}` as Address;
export const deployment = `8453:${contract}`;
export const collection =
  "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d" as Address;
export const origin = "https://www.yunipals.com";

export function strictPool(
  respond: (
    sql: string,
    args: readonly unknown[]
  ) => Record<string, unknown>[] | Promise<Record<string, unknown>[]>
) {
  const calls: { sql: string; args: readonly unknown[] }[] = [];
  let releases = 0;
  const query = async (sql: string, args: readonly unknown[] = []) => {
    calls.push({ sql, args });
    const rows = [
      "BEGIN",
      "COMMIT",
      "ROLLBACK",
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"
    ].includes(sql)
      ? []
      : await respond(sql, args);
    return { rows, rowCount: rows.length };
  };
  const pool = {
    query,
    connect: async () => ({
      query,
      release: () => {
        releases++;
      }
    })
  } as unknown as Pool;
  return { pool, calls, releases: () => releases };
}

export function assertNoRemoteIo() {
  globalThis.fetch = async () => {
    assert.fail(
      "Acceptance must not call a host, provider or public endpoint."
    );
  };
}

assertNoRemoteIo();
