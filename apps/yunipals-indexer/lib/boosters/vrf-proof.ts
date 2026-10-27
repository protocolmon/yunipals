import {
  decodeFunctionData,
  encodeAbiParameters,
  keccak256,
  parseAbi,
  toHex,
  toRlp,
  type Hex
} from "viem";

const proofStruct =
  "struct Proof { uint256[2] pk; uint256[2] gamma; uint256 c; uint256 s; uint256 seed; address uWitness; uint256[2] cGammaWitness; uint256[2] sHashWitness; uint256 zInv; }";
const commitmentStruct =
  "struct Commitment { uint64 blockNum; uint256 subId; uint32 callbackGasLimit; uint32 numWords; address sender; bytes extraArgs; }";
export const coordinatorProofAbi = parseAbi([
  proofStruct,
  commitmentStruct,
  "function fulfillRandomWords(Proof proof, Commitment rc, bool onlyPremium) returns (uint96)"
]);
export const batchProofAbi = parseAbi([
  proofStruct,
  commitmentStruct,
  "function fulfillRandomWords(Proof[] proofs, Commitment[] rcs)"
]);

export function proofRequestId(proof: {
  pk: readonly [bigint, bigint];
  seed: bigint;
}) {
  const keyHash = keccak256(
    encodeAbiParameters([{ type: "uint256[2]" }], [proof.pk])
  );
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }],
        [keyHash, proof.seed]
      )
    )
  );
}

/** Decoding finds evidence; only the onchain verifier authenticates the proof. */
export function extractVrfProof(input: Hex, requestId: bigint) {
  const direct = (() => {
    try {
      return decodeFunctionData({ abi: coordinatorProofAbi, data: input });
    } catch {
      return null;
    }
  })();
  if (direct) {
    const [proof, commitment] = direct.args;
    if (proofRequestId(proof) !== requestId)
      throw new Error("Fulfillment contains a different request.");
    return { proof, commitment };
  }
  const batch = decodeFunctionData({ abi: batchProofAbi, data: input });
  const [proofs, commitments] = batch.args;
  const index = proofs.findIndex(
    (proof) => proofRequestId(proof) === requestId
  );
  if (index < 0 || !commitments[index])
    throw new Error("Fulfillment does not contain this request.");
  return { proof: proofs[index]!, commitment: commitments[index]! };
}

/** Raw eth_getBlockByNumber fields, not viem's formatted block. */
export type RpcHeader = Record<string, unknown>;
export function encodeBlockHeader(block: RpcHeader): Hex {
  const required = (key: string): Hex => {
    const value = block[key];
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value))
      throw new Error(`Missing block header field: ${key}`);
    return value as Hex;
  };
  const integer = (key: string): Hex => {
    const value = BigInt(required(key));
    return value === 0n ? "0x" : toHex(value);
  };
  const fields: Hex[] = [
    required("parentHash"),
    required("sha3Uncles"),
    required("miner"),
    required("stateRoot"),
    required("transactionsRoot"),
    required("receiptsRoot"),
    required("logsBloom"),
    integer("difficulty"),
    integer("number"),
    integer("gasLimit"),
    integer("gasUsed"),
    integer("timestamp"),
    required("extraData"),
    required("mixHash"),
    required("nonce")
  ];
  const optional = [
    ["baseFeePerGas", true],
    ["withdrawalsRoot", false],
    ["blobGasUsed", true],
    ["excessBlobGas", true],
    ["parentBeaconBlockRoot", false],
    ["requestsHash", false]
  ] as const;
  let ended = false;
  for (const [key, numeric] of optional) {
    if (block[key] == null) ended = true;
    else {
      if (ended) throw new Error(`Noncontiguous optional header field: ${key}`);
      fields.push(numeric ? integer(key) : required(key));
    }
  }
  const encoded = toRlp(fields);
  if (keccak256(encoded).toLowerCase() !== required("hash").toLowerCase())
    throw new Error(
      "RPC header hash mismatch; refusing unauthenticated headers."
    );
  return encoded;
}
