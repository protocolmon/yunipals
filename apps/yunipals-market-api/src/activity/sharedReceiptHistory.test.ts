import assert from "node:assert/strict";
import { test } from "node:test";
import { collectionAbi } from "@protopals/yunipals-market-core/collectionAbi";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import type { IndexerReader } from "@protopals/yunipals-indexer-server/readers";
import { sharedCollectionSaleConfiguration } from "./sharedCollectionReplay";
import { sharedBnbSaleConfiguration } from "./sharedBnbReplay";

function reader(
  chain: "base" | "bnb",
  receiptStartBlock?: string
): Pick<IndexerReader, "release"> {
  const definition = marketplaceChains[chain];
  return {
    release: {
      id: `0x${"12".repeat(32)}`,
      schema: "receipt_history_fixture",
      buildId: "receipt-history-fixture",
      manifestHash: `0x${"34".repeat(32)}`,
      manifest: {
        version: 1,
        ponderVersion: "0.17.5",
        ordering: "multichain",
        coverage: "ponder-live-blocks-v1",
        sources: [
          {
            id: `ownership:${chain}`,
            feature: "ownership",
            chainId: definition.chainId,
            contractName: "Collection",
            address: definition.contractAddress.toLowerCase(),
            startBlock: "100",
            endBlock: null,
            enabled: true,
            abiHash: manifestDigest(collectionAbi),
            events: ["Transfer"],
            receiptRequirement: "full",
            policies: [{ kind: "finalized" }],
            ...(receiptStartBlock === undefined ? {} : { receiptStartBlock })
          }
        ]
      }
    }
  };
}

test("collection sale registration rejects history earlier than its receipt floor", () => {
  const config = {
    chain: "base",
    startBlock: "119",
    confirmations: 3,
    policy: "receipt-floor-test-v1",
    confirmationPolicy: { kind: "finalized" }
  } as const;
  const legacy = sharedCollectionSaleConfiguration(reader("base"), config);
  assert.throws(
    () => sharedCollectionSaleConfiguration(reader("base", "120"), config),
    /history boundary/
  );
  const atFloor = sharedCollectionSaleConfiguration(reader("base", "120"), {
    ...config,
    startBlock: "120"
  });
  assert.notEqual(atFloor.configurationHash, legacy.configurationHash);
  assert.throws(
    () =>
      sharedCollectionSaleConfiguration(reader("base"), {
        ...config,
        startBlock: "99"
      }),
    /history boundary/,
    "Receipt floors cannot align a consumer that predates ownership history."
  );
});

test("BNB registration binds the receipt floor but preserves complete ownership start", () => {
  const config = {
    confirmationPolicy: { kind: "finalized" },
    policy: "receipt-floor-test-v1"
  } as const;
  const baseline = sharedBnbSaleConfiguration(reader("bnb"), config);
  const floored = sharedBnbSaleConfiguration(reader("bnb", "120"), config);
  assert.equal(baseline.receiptStartBlock, undefined);
  assert.equal(floored.startBlock, "100");
  assert.equal(floored.receiptStartBlock, "120");
  assert.notEqual(floored.configurationHash, baseline.configurationHash);
});
