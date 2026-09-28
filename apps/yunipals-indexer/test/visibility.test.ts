import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  visibilitySigningDataJson,
  visibilityTypedData,
  verifyVisibilitySignature,
  type VisibilityMessage
} from "../lib/api/visibility.js";
import { migrations } from "../lib/offchain/migrations.js";

const account = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
const message: VisibilityMessage = {
  owner: account.address,
  tokenId: "1000000000000",
  lifecycle: 1,
  ownershipTransactionHash: `0x${"12".repeat(32)}`,
  ownershipLogIndex: 7,
  hidden: true,
  nonce: "0",
  deadline: 2_000_000_000
};

describe("NFT visibility signatures", () => {
  it("verifies the exact EIP-712 action", async () => {
    const signature = await account.signTypedData(visibilityTypedData("ethereum", message));
    await expect(verifyVisibilitySignature("ethereum", message, signature)).resolves.toBe(true);
  });

  it("rejects action tampering and cross-chain replay", async () => {
    const signature = await account.signTypedData(visibilityTypedData("ethereum", message));
    await expect(verifyVisibilitySignature("ethereum", { ...message, hidden: false }, signature)).resolves.toBe(false);
    await expect(verifyVisibilitySignature("polygon", message, signature)).resolves.toBe(false);
  });

  it("returns JSON-safe typed data for wallet clients", () => {
    const signingData = visibilitySigningDataJson("base", { ...message, nonce: "9007199254740993" });
    expect(() => JSON.stringify(signingData)).not.toThrow();
    expect(signingData.message.nonce).toBe("9007199254740993");
    expect(signingData.domain.chainId).toBe(8453);
  });

  it("uses BNB chain ID and rejects a BNB signature on another chain", async () => {
    const typedData = visibilityTypedData("bnb", message);
    expect(typedData.domain.chainId).toBe(56);
    const signature = await account.signTypedData(typedData);
    await expect(verifyVisibilitySignature("bnb", message, signature)).resolves.toBe(true);
    await expect(verifyVisibilitySignature("ethereum", message, signature)).resolves.toBe(false);
  });
});

describe("NFT visibility persistence", () => {
  it("defines idempotent preference and nonce tables", () => {
    expect(migrations.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS metadata.token_visibility"))).toBe(true);
    expect(migrations.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS metadata.wallet_visibility_nonce"))).toBe(true);
  });
});
