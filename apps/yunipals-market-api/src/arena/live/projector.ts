import type { Pool } from "pg";
import { decodeEventLog, type Address, type PublicClient } from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { readConfirmedBlock } from "@/confirmations";
import { projectEvent } from "./projection";

export type ArenaDeployment = {
  id: string;
  contract: Address;
  startBlock: bigint;
};

// Only confirmed Base blocks enter the DB. A confirmed-history mismatch stops intake
// and spending; it must not silently erase already disclosed prompts or settled work.
export async function projectConfirmedArena(
  pool: Pool,
  rpc: PublicClient,
  deployment: ArenaDeployment
) {
  const db = await pool.connect();
  let locked = false;
  try {
    locked = Boolean(
      (
        await db.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
          [`arena/project/${deployment.id}`]
        )
      ).rows[0]?.locked
    );
    if (!locked) return { status: "busy" };
    await db.query(
      "INSERT INTO yunipals_arena.deployment(id,contract,start_block) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [
        deployment.id,
        deployment.contract.toLowerCase(),
        deployment.startBlock.toString()
      ]
    );
    const saved = (
      await db.query<{
        cursor: string | null;
        cursor_hash: string | null;
        halted: boolean;
        start_block: string;
        contract: string;
      }>("SELECT * FROM yunipals_arena.deployment WHERE id=$1", [deployment.id])
    ).rows[0]!;
    if (
      saved.contract !== deployment.contract.toLowerCase() ||
      BigInt(saved.start_block) !== deployment.startBlock
    )
      throw new Error("Arena deployment configuration changed.");
    if (saved.halted) return { status: "halted" };
    if (saved.cursor !== null) {
      const checkpoint = await rpc.getBlock({
        blockNumber: BigInt(saved.cursor)
      });
      if (checkpoint.hash !== saved.cursor_hash) {
        await db.query(
          "UPDATE yunipals_arena.deployment SET halted=true,halt_reason='confirmed_history_changed' WHERE id=$1",
          [deployment.id]
        );
        return { status: "halted" };
      }
    }
    const head = await readConfirmedBlock(rpc, 8453);
    const from =
      saved.cursor === null ? deployment.startBlock : BigInt(saved.cursor) + 1n;
    if (from > head.number) {
      await db.query(
        "UPDATE yunipals_arena.deployment SET finalized_at=now() WHERE id=$1",
        [deployment.id]
      );
      return { status: "caught-up" };
    }
    const to = from + 499n < head.number ? from + 499n : head.number;
    const logs = await rpc.getLogs({
      address: deployment.contract,
      fromBlock: from,
      toBlock: to
    });
    const end =
      to === head.number ? head : await rpc.getBlock({ blockNumber: to });
    await db.query("BEGIN");
    try {
      for (const log of logs) {
        if (
          log.removed ||
          log.blockNumber === null ||
          log.blockHash === null ||
          log.logIndex === null ||
          log.transactionHash === null
        )
          throw new Error("Incomplete confirmed log.");
        const decoded = decodeEventLog({
          abi: arenaAbi,
          data: log.data,
          topics: log.topics,
          strict: true
        });
        await projectEvent(db, deployment.id, {
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
          eventName: decoded.eventName,
          args: decoded.args as Record<string, unknown>
        });
      }
      await db.query(
        "UPDATE yunipals_arena.deployment SET cursor=$2,cursor_hash=$3,finalized_at=CASE WHEN $4 THEN now() ELSE finalized_at END WHERE id=$1",
        [deployment.id, to.toString(), end.hash, to === head.number]
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
    return { status: "advanced", block: to.toString() };
  } finally {
    if (locked)
      await db.query("SELECT pg_advisory_unlock(hashtext($1))", [
        `arena/project/${deployment.id}`
      ]);
    db.release();
  }
}
