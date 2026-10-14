import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const [release, directory] = process.argv.slice(2);
assert(release && directory && process.env.DATABASE_URL);
const require = createRequire(`${release}/package.json`);
const { Pool } = require("pg");
const { createPublicClient, http, parseAbi } = require("viem");
const { base } = require("viem/chains");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const rpc = createPublicClient({
  chain: base,
  transport: http("http://127.0.0.1:19202", { retryCount: 0, timeout: 20_000 })
});
const contract = "0x1058f1a6fedcaec94e488d6ec3c639e541faf066";
const abi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function totalSupply() view returns (uint256)"
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
await mkdir(directory, { recursive: true, mode: 0o700 });
try {
  assert.equal(await rpc.getChainId(), 8453);
  const block = await rpc.getBlock({ blockTag: "finalized" });
  assert(block.number !== null && block.hash);
  const code = await rpc.getCode({
    address: contract,
    blockNumber: block.number
  });
  assert.equal(
    hash(Buffer.from(code.slice(2), "hex")),
    "8d2c974b8266116fdd1391dd6ede92f1130a9922adc60d81bfc3302233d644f4"
  );
  const cursor = (
    await pool.query(
      "SELECT last_scanned_block::text FROM yunipals_base_islands_v1.sync_state WHERE singleton"
    )
  ).rows[0];
  assert(
    BigInt(cursor.last_scanned_block) >= block.number,
    "Indexer has not reached snapshot block"
  );
  const tokens = (
    await pool.query(
      `SELECT o.token_id AS "tokenId", o.owner,
      a.recipient AS "originalRecipient" FROM (
      SELECT DISTINCT ON(token_id) token_id, "to" AS owner
      FROM yunipals_base_islands_v1.transfer_event WHERE block_number <= $1
      ORDER BY token_id,block_number DESC,transaction_index DESC,log_index DESC
    ) o JOIN metadata.island_airdrop_origin a ON a.token_id=o.token_id
    WHERE o.owner <> '0x0000000000000000000000000000000000000000'
    ORDER BY o.token_id::numeric`,
      [String(block.number)]
    )
  ).rows;
  assert.equal(tokens.length, 898);
  assert.equal(
    await rpc.readContract({
      address: contract,
      abi,
      functionName: "totalSupply",
      blockNumber: block.number
    }),
    898n
  );
  for (let start = 0; start < tokens.length; start += 50) {
    const batch = tokens.slice(start, start + 50);
    const owners = await rpc.multicall({
      blockNumber: block.number,
      allowFailure: false,
      contracts: batch.map(({ tokenId }) => ({
        address: contract,
        abi,
        functionName: "ownerOf",
        args: [BigInt(tokenId)]
      }))
    });
    assert(
      owners.every((owner, index) => owner.toLowerCase() === batch[index].owner)
    );
  }
  assert.equal(
    (await rpc.getBlock({ blockNumber: block.number })).hash,
    block.hash
  );
  const snapshot = {
    schemaVersion: 1,
    source: {
      chainId: 8453,
      contract,
      blockNumber: String(block.number),
      blockHash: block.hash,
      timestamp: String(block.timestamp)
    },
    recipientPolicy: "current-base-owner-at-finalized-snapshot",
    expectedSupply: 898,
    changedRecipients: tokens.filter((t) => t.owner !== t.originalRecipient)
      .length,
    tokens
  };
  const bytes = JSON.stringify(snapshot, null, 2) + "\n";
  const path = `${directory}/snapshot.json`;
  try {
    const previous = await readFile(path, "utf8");
    assert.equal(
      previous,
      bytes,
      "A snapshot already exists; never silently replace it"
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  }
  console.log(
    JSON.stringify(
      {
        snapshotPath: path,
        snapshotSha256: hash(bytes),
        source: snapshot.source,
        verifiedOwners: tokens.length,
        changedRecipients: snapshot.changedRecipients
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}
