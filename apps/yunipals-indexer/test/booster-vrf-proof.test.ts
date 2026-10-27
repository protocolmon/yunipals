import assert from "node:assert/strict";
import data from "../../../contracts/boosters/test/fixtures/base-vrf-proofs.json" with { type: "json" };
import blocks from "../../../contracts/boosters/test/fixtures/base-block-headers.json" with { type: "json" };
import { test } from "vitest";
import { encodeFunctionData, type Address } from "viem";
import {
  batchProofAbi,
  coordinatorProofAbi,
  encodeBlockHeader,
  extractVrfProof,
  proofRequestId
} from "../lib/boosters/vrf-proof";

const pair = (values: string[]): [bigint, bigint] => [
  BigInt(values[0]!),
  BigInt(values[1]!)
];
const fixtures = data.map((f: (typeof data)[number]) => ({
  id: BigInt(f.requestId),
  proof: {
    pk: pair(f.proof.pk),
    gamma: pair(f.proof.gamma),
    c: BigInt(f.proof.c),
    s: BigInt(f.proof.s),
    seed: BigInt(f.proof.seed),
    uWitness: f.proof.uWitness as Address,
    cGammaWitness: pair(f.proof.cGammaWitness),
    sHashWitness: pair(f.proof.sHashWitness),
    zInv: BigInt(f.proof.zInv)
  },
  commitment: {
    blockNum: BigInt(f.commitment.blockNum),
    subId: BigInt(f.commitment.subId),
    callbackGasLimit: Number(f.commitment.callbackGasLimit),
    numWords: Number(f.commitment.numWords),
    sender: f.commitment.sender as Address,
    extraArgs: f.commitment.extraArgs as `0x${string}`
  }
}));

test("matches all real Base request IDs and extracts direct coordinator proofs", () => {
  for (const f of fixtures) {
    assert.equal(proofRequestId(f.proof), f.id);
    const input = encodeFunctionData({
      abi: coordinatorProofAbi,
      functionName: "fulfillRandomWords",
      args: [f.proof, f.commitment, false]
    });
    assert.deepEqual(extractVrfProof(input, f.id), {
      proof: f.proof,
      commitment: f.commitment
    });
    assert.throws(() => extractVrfProof(input, 0n), /different request/);
  }
});

test("selects the right proof in batched fulfillment without trusting array position", () => {
  const input = encodeFunctionData({
    abi: batchProofAbi,
    functionName: "fulfillRandomWords",
    args: [
      fixtures.map((f: (typeof fixtures)[number]) => f.proof),
      fixtures.map((f: (typeof fixtures)[number]) => f.commitment)
    ]
  });
  for (const f of fixtures)
    assert.deepEqual(extractVrfProof(input, f.id), {
      proof: f.proof,
      commitment: f.commitment
    });
  assert.throws(() => extractVrfProof(input, 0n), /does not contain/);
  assert.throws(() => extractVrfProof("0x12345678", fixtures[0].id));
});

test("serializes canonical Base headers and refuses changed or incomplete fields", () => {
  for (const block of blocks) {
    assert.equal(encodeBlockHeader(block), block.rlp);
    assert.throws(
      () => encodeBlockHeader({ ...block, parentHash: `0x${"00".repeat(32)}` }),
      /hash mismatch/
    );
    assert.throws(
      () => encodeBlockHeader({ ...block, gasUsed: undefined }),
      /Missing/
    );
    assert.throws(
      () => encodeBlockHeader({ ...block, withdrawalsRoot: undefined }),
      /Noncontiguous/
    );
  }
});
