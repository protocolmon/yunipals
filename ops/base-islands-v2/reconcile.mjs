import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
const work = "/srv/yunipals-islands/base-replacement-v2";
const manifest = JSON.parse(
  await readFile(`${work}/source-manifest.json`, "utf8")
);
const require = createRequire(
  `/opt/yunipals-islands/releases/${manifest.releaseId}/package.json`
);
const { createPublicClient, http, parseAbi, parseAbiItem } = require("viem");
const { base } = require("viem/chains");
const rpc = createPublicClient({
  chain: base,
  transport: http("http://127.0.0.1:19202", { retryCount: 0, timeout: 20000 })
});
const bytes = await readFile(`${work}/snapshot.json`);
const sha = createHash("sha256").update(bytes).digest("hex");
assert.equal(
  sha,
  "7a0af719a7f13ea8b94df6f64c1c1573657b412ddd5b39fa5651ddf973b9d2d7"
);
const tokens = JSON.parse(bytes).tokens;
const address = "0x79b68a12a2952a9a8d0cc4d0b3fb00252c41d168";
const uri = "https://islands-meta.yunipals.com/v2/base-islands/";
const blockNumber = 52588159n;
const abi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function totalSupply() view returns (uint256)"
]);
async function read(fn) {
  for (let n = 0; n < 4; n++) {
    try {
      const value = await fn();
      await delay(500);
      return value;
    } catch (error) {
      if (n === 3) throw error;
      await delay(2000);
    }
  }
}
try {
  assert.equal(await read(() => rpc.getChainId()), 8453);
  const block = await read(() => rpc.getBlock({ blockNumber }));
  assert.equal(
    await read(() =>
      rpc.readContract({
        address,
        abi,
        functionName: "totalSupply",
        blockNumber
      })
    ),
    898n
  );
  const changes = [];
  for (let start = 0; start < tokens.length; start += 40) {
    const batch = tokens.slice(start, start + 40);
    const values = await read(() =>
      rpc.multicall({
        blockNumber,
        allowFailure: false,
        batchSize: 16000,
        contracts: batch.flatMap((t) =>
          ["ownerOf", "tokenURI"].map((functionName) => ({
            address,
            abi,
            functionName,
            args: [BigInt(t.tokenId)]
          }))
        )
      })
    );
    for (const [i, t] of batch.entries()) {
      assert.equal(values[2 * i + 1], uri + t.tokenId);
      const actual = values[2 * i].toLowerCase();
      if (actual !== t.owner) {
        const label = `mint-${String(Math.floor(start / 40)).padStart(2, "0")}`;
        const mint = JSON.parse(
          await readFile(`${work}/receipts/${label}.json`, "utf8")
        );
        let owner = "0x0000000000000000000000000000000000000000",
          minted = false;
        for (
          let from = BigInt(mint.blockNumber);
          from <= blockNumber;
          from += 10n
        ) {
          const logs = await read(() =>
            rpc.getLogs({
              address,
              event: parseAbiItem(
                "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)"
              ),
              args: { tokenId: BigInt(t.tokenId) },
              fromBlock: from,
              toBlock: from + 9n < blockNumber ? from + 9n : blockNumber
            })
          );
          for (const log of logs) {
            assert.equal(log.args.from.toLowerCase(), owner);
            owner = log.args.to.toLowerCase();
            if (!minted) {
              assert.equal(log.transactionHash, mint.hash);
              assert.equal(owner, t.owner);
              minted = true;
            } else
              changes.push({
                tokenId: t.tokenId,
                from: log.args.from.toLowerCase(),
                to: owner,
                transactionHash: log.transactionHash,
                blockNumber: Number(log.blockNumber)
              });
          }
        }
        assert(minted);
        assert.equal(owner, actual);
      }
    }
    console.log(JSON.stringify({ verified: Math.min(start + 40, 898) }));
  }
  assert.equal(
    (await read(() => rpc.getBlock({ blockNumber }))).hash,
    block.hash
  );
  const report = {
    verifiedAtUTC: new Date().toISOString(),
    contract: address,
    blockNumber: Number(blockNumber),
    blockHash: block.hash,
    ownersVerified: 898,
    distinctMetadataUrisVerified: 898,
    snapshotSha256: sha,
    postMintTransfers: changes,
    passed: true
  };
  await writeFile(
    `${work}/reconciliation.json`,
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : "RPC audit deferred; retry only after checking gateway state"
  );
  process.exitCode = 1;
}
