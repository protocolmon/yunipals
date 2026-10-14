import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  legacyBaseIslandCollection,
  replacementSnapshotSha256,
  replacementSnapshotBlock,
  replacementSnapshotBlockHash
} from "./collections.js";

export async function loadReplacementSnapshot() {
  const bytes = await readFile(
    new URL(
      "../../data/islands/base-replacement-snapshot.json",
      import.meta.url
    )
  );
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    replacementSnapshotSha256
  )
    throw new Error("replacement_snapshot_hash_mismatch");
  const snapshot = z
    .object({
      source: z.object({
        chainId: z.literal(8453),
        contract: z.literal(legacyBaseIslandCollection.address),
        blockNumber: z.literal(String(replacementSnapshotBlock)),
        blockHash: z.literal(replacementSnapshotBlockHash)
      }),
      tokens: z.array(
        z.object({
          tokenId: z.string().regex(/^[1-9]\d*$/),
          owner: z.string().regex(/^0x[0-9a-f]{40}$/)
        })
      )
    })
    .parse(JSON.parse(bytes.toString()));
  if (
    snapshot.tokens.length !== 898 ||
    new Set(snapshot.tokens.map((t) => t.tokenId)).size !== 898
  )
    throw new Error("replacement_snapshot_identity_mismatch");
  return snapshot.tokens;
}
