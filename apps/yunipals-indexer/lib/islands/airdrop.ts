import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  airdropSnapshotSha256,
  airdropSnapshotBlock,
  airdropSnapshotBlockHash
} from "./collections.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const snapshotSchema = z.object({
  collection: z.object({ chainId: z.literal(1), contract: address }),
  snapshot: z.object({ blockNumber: z.string(), blockHash: z.string() }),
  tokens: z.array(
    z.object({
      tokenId: z.string().regex(/^[1-9]\d*$/),
      sourceOwner: address,
      effectiveOwner: address,
      eligible: z.literal(true)
    })
  )
});

export async function loadAirdropSnapshot() {
  const bytes = await readFile(
    new URL("../../data/islands/base-airdrop-snapshot.json", import.meta.url)
  );
  if (
    createHash("sha256").update(bytes).digest("hex") !== airdropSnapshotSha256
  )
    throw new Error("airdrop_snapshot_hash_mismatch");
  const snapshot = snapshotSchema.parse(JSON.parse(bytes.toString()));
  if (
    snapshot.collection.contract.toLowerCase() !==
      "0xa22e2f53ca787414dc0643c399f92234949e2305" ||
    snapshot.snapshot.blockNumber !== String(airdropSnapshotBlock) ||
    snapshot.snapshot.blockHash !== airdropSnapshotBlockHash ||
    snapshot.tokens.length !== 898 ||
    new Set(snapshot.tokens.map((t) => t.tokenId)).size !== 898
  )
    throw new Error("airdrop_snapshot_identity_mismatch");
  return snapshot.tokens;
}
