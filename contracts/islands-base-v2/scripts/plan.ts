import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { AbiCoder, concat, getAddress, keccak256 } from "ethers";

export const oldBaseContract = "0x1058f1a6fedcaec94e488d6ec3c639e541faf066";
export const metadataBaseUri =
  "https://islands-meta.yunipals.com/v2/base-islands/";
export const revealAssignmentsSha256 =
  "cfdc7ea0a31f1779e1ef5e2a6e00a1f262b411226022b318f797697dfbb3fc2e";
export const revealCommitmentSha256 =
  "d65a6414bc8c927bf047f0430862f5bb2e451deb9a84e15151100af4f1cdbdd4";
export const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

export interface Snapshot {
  schemaVersion: number;
  source: {
    chainId: number;
    contract: string;
    blockNumber: string;
    blockHash: string;
    timestamp: string;
  };
  recipientPolicy: string;
  expectedSupply: number;
  changedRecipients: number;
  tokens: { tokenId: string; owner: string; originalRecipient: string }[];
}
export interface Distribution {
  schemaVersion: number;
  snapshotSha256: string;
  source: Snapshot["source"];
  metadataBaseUri: string;
  revealAssignmentsSha256: string;
  revealCommitmentSha256: string;
  root: string;
  tokens: { tokenId: string; recipient: string; proof: string[] }[];
}

export function leaf(tokenId: string, recipient: string) {
  return keccak256(
    keccak256(
      AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [tokenId, recipient]
      )
    )
  );
}
const parent = (a: string, b: string) => keccak256(concat([a, b].sort()));

export function distribution(
  snapshot: Snapshot,
  snapshotSha256: string
): Distribution {
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.source.chainId, 8453);
  assert.equal(snapshot.source.contract, oldBaseContract);
  assert.match(snapshot.source.blockNumber, /^[1-9]\d*$/);
  assert.match(snapshot.source.blockHash, /^0x[0-9a-f]{64}$/);
  assert.equal(
    snapshot.recipientPolicy,
    "current-base-owner-at-finalized-snapshot"
  );
  assert.equal(snapshot.expectedSupply, 898);
  assert.equal(snapshot.tokens.length, 898);
  const expected = [
    ...Array.from({ length: 525 }, (_, i) => String(i + 1)),
    ...Array.from({ length: 373 }, (_, i) => String(i + 1001))
  ];
  assert.deepEqual(
    snapshot.tokens.map((t) => t.tokenId),
    expected
  );
  const tokens = snapshot.tokens.map((t) => {
    const recipient = getAddress(t.owner).toLowerCase();
    assert.notEqual(recipient, "0x0000000000000000000000000000000000000000");
    return { tokenId: t.tokenId, recipient, proof: [] as string[] };
  });
  const layers: string[][] = [tokens.map((t) => leaf(t.tokenId, t.recipient))];
  while (layers.at(-1)!.length > 1) {
    const previous = layers.at(-1)!;
    const next: string[] = [];
    for (let i = 0; i < previous.length; i += 2)
      next.push(parent(previous[i]!, previous[i + 1] ?? previous[i]!));
    layers.push(next);
  }
  tokens.forEach((t, index) => {
    let position = index;
    for (const layer of layers.slice(0, -1)) {
      t.proof.push(layer[position ^ 1] ?? layer[position]!);
      position = Math.floor(position / 2);
    }
  });
  return {
    schemaVersion: 1,
    snapshotSha256,
    source: snapshot.source,
    metadataBaseUri,
    revealAssignmentsSha256,
    revealCommitmentSha256,
    root: layers.at(-1)![0]!,
    tokens
  };
}

export function loadDistribution(): Distribution {
  const bytes = readFileSync("data/snapshot.json");
  const manifest = JSON.parse(
    readFileSync("data/distribution.manifest.json", "utf8")
  ) as { snapshotSha256: string; distributionSha256: string };
  assert.equal(sha256(bytes), manifest.snapshotSha256);
  const generated = distribution(
    JSON.parse(bytes.toString()) as Snapshot,
    manifest.snapshotSha256
  );
  const stored = readFileSync("data/distribution.json");
  assert.equal(sha256(stored), manifest.distributionSha256);
  assert.deepEqual(JSON.parse(stored.toString()), generated);
  return generated;
}

export function prepareDistribution() {
  const bytes = readFileSync("data/snapshot.json");
  const snapshotSha256 = sha256(bytes);
  const plan = distribution(
    JSON.parse(bytes.toString()) as Snapshot,
    snapshotSha256
  );
  const serialized = JSON.stringify(plan, null, 2) + "\n";
  writeFileSync("data/distribution.json", serialized, { flag: "wx" });
  writeFileSync(
    "data/distribution.manifest.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        snapshotSha256,
        distributionSha256: sha256(serialized),
        root: plan.root
      },
      null,
      2
    ) + "\n",
    { flag: "wx" }
  );
  console.log(
    JSON.stringify(
      {
        snapshotSha256,
        distributionSha256: sha256(serialized),
        root: plan.root,
        tokens: plan.tokens.length
      },
      null,
      2
    )
  );
}
