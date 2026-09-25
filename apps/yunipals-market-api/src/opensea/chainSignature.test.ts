import assert from "node:assert/strict";
import { test } from "node:test";
import { zeroAddress, type PublicClient } from "viem";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { admissionFixture } from "@/opensea/fixtures/admission";
import { verifyOpenSeaMakerSignature } from "@/opensea/chain";

test("unrecognized maker bytes require a successful Seaport validation from a non-maker at the inspected block", async () => {
  const item = await admissionFixture();
  const signature = `0x${"11".repeat(259)}` as const;
  let result: unknown = true;
  let calls = 0;
  let walletProbes = 0;
  const client = {
    ...item.client,
    async getCode() {
      walletProbes++;
      throw new Error(
        "Nonstandard signatures must go directly to Seaport, including delegated makers"
      );
    },
    async readContract() {
      walletProbes++;
      throw new Error(
        "A preliminary ERC-1271 probe is not a bulk signature verifier"
      );
    },
    async simulateContract(request: {
      address: string;
      account: string;
      blockNumber: bigint;
      functionName: string;
      args: { signature: string; parameters: { offerer: string } }[][];
    }) {
      calls++;
      assert.equal(request.address, seaportDeployment.address);
      assert.equal(request.account, zeroAddress);
      assert.notEqual(request.account, item.input.order.offerer);
      assert.equal(request.blockNumber, 121n);
      assert.equal(request.functionName, "validate");
      assert.equal(request.args[0]?.[0]?.signature, signature);
      assert.equal(
        request.args[0]?.[0]?.parameters.offerer,
        item.input.order.offerer
      );
      return { result };
    }
  } as unknown as PublicClient;
  assert.equal(
    await verifyOpenSeaMakerSignature(
      client,
      "ethereum",
      item.input.order,
      signature,
      121n
    ),
    true
  );
  result = false;
  assert.equal(
    await verifyOpenSeaMakerSignature(
      client,
      "ethereum",
      item.input.order,
      signature,
      121n
    ),
    false
  );
  assert.equal(calls, 2);
  assert.equal(
    await verifyOpenSeaMakerSignature(
      { ...client, getChainId: async () => 137 } as PublicClient,
      "ethereum",
      item.input.order,
      signature,
      121n
    ),
    false
  );
  assert.equal(calls, 2);
  assert.equal(walletProbes, 0);
});

test("nonstandard signatures cannot fall back to a permissive wallet when Seaport rejects them", async () => {
  const item = await admissionFixture();
  let walletReads = 0;
  const client = {
    ...item.client,
    getCode: async () => "0xef0100",
    readContract: async () => {
      walletReads++;
      return "0x1626ba7e";
    },
    simulateContract: async () => {
      throw new Error("Seaport rejected the signature");
    }
  } as unknown as PublicClient;
  assert.equal(
    await verifyOpenSeaMakerSignature(
      client,
      "ethereum",
      item.input.order,
      `0x${"11".repeat(259)}`,
      121n
    ),
    false
  );
  assert.equal(walletReads, 0);
});
