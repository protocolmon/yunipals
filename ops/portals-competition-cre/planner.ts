import {
  encodeAbiParameters,
  parseAbiParameters,
  type Address,
  type Hex
} from "viem";

export function recoveryIndices(
  count: bigint,
  minute: bigint,
  maximum = 3
): bigint[] {
  if (count <= 0n || maximum < 1 || maximum > 3) return [];
  const length = count < BigInt(maximum) ? Number(count) : maximum;
  // Advance one slot each minute so a failed batch cannot starve later batches.
  const start = minute % count;
  return Array.from({ length }, (_, i) => (start + BigInt(i)) % count);
}

export function settlementReport(
  chainId: number,
  pool: Address,
  rulesHash: Hex,
  batchId: bigint
): Hex {
  if (!Number.isSafeInteger(chainId) || chainId < 1 || batchId < 1n)
    throw new Error("Invalid settlement domain.");
  return encodeAbiParameters(
    parseAbiParameters(
      "uint256 chainId,address pool,bytes32 rules,uint256 batchId"
    ),
    [BigInt(chainId), pool, rulesHash, batchId]
  );
}
