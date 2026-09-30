import { closePool, pool } from "../lib/offchain/db.js";
import { createPublicClient, http, parseAbi } from "viem";
import { bsc } from "viem/chains";
import { collections } from "../lib/constants.js";
import { bnbSchema } from "../lib/offchain/sql.js";
import { bnbRpcUrlOf } from "../lib/rpc.js";

const client = createPublicClient({ chain: bsc, transport: http(bnbRpcUrlOf()) });
const supplyAbi = parseAbi(["function totalSupply() view returns (uint256)"]);

try {
  const result = await pool.query(`SELECT next_block::text AS "nextBlock",
    last_scanned_block::text AS "lastScannedBlock", last_scanned_hash AS "lastScannedHash",
    caught_up_at AS "caughtUpAt", last_error AS "lastError", updated_at AS "updatedAt",
    (SELECT count(*)::int FROM ${bnbSchema}.token) AS "knownTokens",
    (SELECT count(*)::int FROM ${bnbSchema}.token WHERE NOT burned) AS "activeSupply",
    (SELECT count(*)::int FROM ${bnbSchema}.transfer_event) AS "transferEvents"
    FROM ${bnbSchema}.sync_state WHERE singleton`);
  const status = result.rows[0];
  if (!status) console.log("null");
  else {
    const head = await client.getBlockNumber();
    const onchainSupply = status.lastScannedBlock
      ? await client.readContract({ address: collections.bnb.address, abi: supplyAbi,
          functionName: "totalSupply", blockNumber: BigInt(status.lastScannedBlock) })
      : null;
    console.log(JSON.stringify({
      ...status,
      head: head.toString(),
      blockLag: status.lastScannedBlock ? (head - BigInt(status.lastScannedBlock)).toString() : null,
      onchainActiveSupplyAtCursor: onchainSupply?.toString() ?? null,
      supplyMatches: onchainSupply === null ? null : BigInt(status.activeSupply) === onchainSupply
    }, null, 2));
  }
} finally {
  await closePool();
}
