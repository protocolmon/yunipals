import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  openSharedConsumer,
  readSharedConsumerEnvironment
} from "@/indexer/consumerEnvironment";
import {
  closeMarketplaceOwnershipIndexer,
  configureMarketplaceOwnershipIndexer,
  marketplaceOwnershipIndexer,
  readMarketplaceOwnershipEnvironment,
  withMarketplaceOwnershipIndexer
} from "@/indexer/ownership";

const ownership = {
  MARKET_OWNERSHIP_INDEXER_MODE: "unified",
  MARKET_OWNERSHIP_INDEXER_DATABASE_URL: "postgresql://reader@127.0.0.1/test",
  MARKET_OWNERSHIP_INDEXER_RELEASE_ID: `0x${"12".repeat(32)}`,
  MARKET_OWNERSHIP_INDEXER_READ_SCHEMA: "ownership_test"
};

afterEach(closeMarketplaceOwnershipIndexer);

test("all source reader selectors preserve four connections by default and accept bounded reductions", () => {
  for (const prefix of [
    "MARKET_SALE_INDEXER",
    "MARKET_BNB_DISCOVERY_INDEXER",
    "MARKET_BNB_SALE_INDEXER"
  ] as const) {
    const input = {
      [`${prefix}_MODE`]: "unified",
      [`${prefix}_DATABASE_URL`]: "postgresql://reader@127.0.0.1/test",
      [`${prefix}_RELEASE_ID`]: ownership.MARKET_OWNERSHIP_INDEXER_RELEASE_ID
    };
    const defaultConfig = readSharedConsumerEnvironment(input, prefix);
    assert.equal(defaultConfig.mode, "unified");
    assert.equal(defaultConfig.poolMax, 4);
    for (const value of ["1", "2", "3", "4"]) {
      const config = readSharedConsumerEnvironment(
        { ...input, [`${prefix}_POOL_MAX`]: value },
        prefix
      );
      assert.equal(config.mode, "unified");
      assert.equal(config.poolMax, Number(value));
    }
    for (const value of ["", "0", "5", "01", "1.5", "1e0", " 1"]) {
      assert.throws(() =>
        readSharedConsumerEnvironment(
          { ...input, [`${prefix}_POOL_MAX`]: value },
          prefix
        )
      );
    }
    assert.throws(() =>
      readSharedConsumerEnvironment({ [`${prefix}_POOL_MAX`]: "1" }, prefix)
    );
  }
});

test("ownership pool configuration is explicit, bounded and cannot accompany legacy mode", () => {
  const unchanged = readMarketplaceOwnershipEnvironment(ownership);
  assert.equal(unchanged.mode, "unified");
  assert.equal(unchanged.poolMax, 4);
  for (const value of ["1", "2"]) {
    const config = readMarketplaceOwnershipEnvironment({
      ...ownership,
      MARKET_OWNERSHIP_INDEXER_POOL_MAX: value
    });
    assert.equal(config.mode, "unified");
    assert.equal(config.poolMax, Number(value));
  }
  for (const value of ["", "0", "5", "01", "2.5", " 1"]) {
    assert.throws(() =>
      readMarketplaceOwnershipEnvironment({
        ...ownership,
        MARKET_OWNERSHIP_INDEXER_POOL_MAX: value
      })
    );
  }
  assert.throws(() =>
    readMarketplaceOwnershipEnvironment({
      MARKET_OWNERSHIP_INDEXER_POOL_MAX: "1"
    })
  );
});

test("signature lifetime selects shared ownership before work and closes it on success and failure", async () => {
  const config = readMarketplaceOwnershipEnvironment({
    ...ownership,
    MARKET_OWNERSHIP_INDEXER_POOL_MAX: "1"
  });
  const result = await withMarketplaceOwnershipIndexer(config, async () => {
    assert.ok(marketplaceOwnershipIndexer());
    return "shared";
  });
  assert.equal(result, "shared");
  assert.equal(marketplaceOwnershipIndexer(), undefined);
  const originalFailure = new Error("provider failure");
  await assert.rejects(
    withMarketplaceOwnershipIndexer(config, async () => {
      assert.ok(marketplaceOwnershipIndexer());
      throw originalFailure;
    }),
    (error) => error === originalFailure
  );
  assert.equal(marketplaceOwnershipIndexer(), undefined);
  // A second start proves that closure also releases the global selection.
  await withMarketplaceOwnershipIndexer(config, async () => {
    assert.ok(marketplaceOwnershipIndexer());
  });
});

test("legacy signature operation creates no shared reader and invalid programmatic caps cannot poison selection", async () => {
  await withMarketplaceOwnershipIndexer({ mode: "legacy" }, async () => {
    assert.equal(marketplaceOwnershipIndexer(), undefined);
  });
  assert.equal(await openSharedConsumer({ mode: "legacy" }), undefined);
  const config = readMarketplaceOwnershipEnvironment(ownership);
  assert.equal(config.mode, "unified");
  assert.throws(() =>
    configureMarketplaceOwnershipIndexer({ ...config, poolMax: 0 })
  );
  assert.equal(marketplaceOwnershipIndexer(), undefined);
  await withMarketplaceOwnershipIndexer(config, async () => {
    assert.ok(marketplaceOwnershipIndexer());
  });
});
