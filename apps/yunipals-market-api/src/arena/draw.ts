import { createHash } from "node:crypto";

import type { Island } from "./types";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Cannot hash undefined input.");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function poolEntries(islands: Island[]) {
  return islands.map(({ tokenId, edition, weight, profileSha256 }) => ({
    tokenId,
    edition,
    weight,
    profileSha256
  }));
}

// Public, deterministic mapping. The caller must verify the VRF fulfillment
// independently in a live adapter; this function does not verify a VRF proof.
export function weightedDraw(input: {
  tournamentId: string;
  poolSha256: string;
  word: string;
  entries: Array<{ tokenId: string; weight: number }>;
}) {
  if (!/^0x[0-9a-f]{64}$/.test(input.word))
    throw new Error("Expected a 256-bit randomness word.");
  const ids = new Set(input.entries.map((entry) => entry.tokenId));
  const total = input.entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (
    !input.entries.length ||
    ids.size !== input.entries.length ||
    !Number.isSafeInteger(total) ||
    input.entries.some(
      (entry) => !Number.isSafeInteger(entry.weight) || entry.weight < 1
    )
  )
    throw new Error("Invalid weighted island pool.");
  const range = 1n << 256n;
  const limit = range - (range % BigInt(total));
  let counter = 0;
  let value: bigint;
  do {
    value = BigInt(
      `0x${sha256(
        canonicalJson([
          "yunipals-arena/island/v1",
          input.tournamentId,
          input.poolSha256,
          input.word,
          counter++
        ])
      )}`
    );
  } while (value >= limit);
  const ticket = Number(value % BigInt(total));
  let end = 0;
  for (const entry of input.entries) {
    end += entry.weight;
    if (ticket < end) return { tokenId: entry.tokenId, ticket };
  }
  throw new Error("Island draw failed.");
}
