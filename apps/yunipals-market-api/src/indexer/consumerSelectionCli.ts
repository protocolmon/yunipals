import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import { createPool } from "@/db/pool";
import { readEnvironment, readSaleReplayEnvironment } from "@/environment";
import { bnbValidationPolicy } from "@/bnb/validation";
import { sharedBnbSaleRuntimeConfiguration } from "@/activity/sharedBnbReplay";
import { buildProductionBnbPolicy } from "@/productionRuntime";
import {
  openSharedConsumer,
  readSharedConsumerEnvironment
} from "./consumerEnvironment";
import {
  selectSharedMarketplaceConsumer,
  type MarketplaceConsumerSelection
} from "./consumerSelection";

const args = process.argv.slice(2);
const consumer = args[0];
const review =
  args.length === 3 &&
  args[1] === "--apply" &&
  /^0x[0-9a-f]{64}$/.test(args[2]!)
    ? args[2]
    : undefined;
if (
  !consumer ||
  (args.length !== 1 && review === undefined) ||
  ![
    "bnb-discovery",
    "bnb-sales",
    "collection-sales:ethereum",
    "collection-sales:base",
    "collection-sales:polygon"
  ].includes(consumer)
)
  throw new Error(
    "Use marketplace-consumer <consumer> [--apply 0x<review-hash>]."
  );
if (!process.env.MARKET_MIGRATION_DATABASE_URL)
  throw new Error(
    "Set MARKET_MIGRATION_DATABASE_URL to the explicit operational owner connection."
  );
const env = readEnvironment({
  ...process.env,
  MARKET_DATABASE_URL: process.env.MARKET_MIGRATION_DATABASE_URL
});
const pool = createPool(env);
let shared: Awaited<ReturnType<typeof openSharedConsumer>>;
try {
  shared = await openSharedConsumer(
    readSharedConsumerEnvironment(
      process.env,
      consumer === "bnb-sales"
        ? "MARKET_BNB_SALE_INDEXER"
        : consumer === "bnb-discovery"
          ? "MARKET_BNB_DISCOVERY_INDEXER"
          : "MARKET_SALE_INDEXER"
    )
  );
  if (!shared)
    throw new Error(
      "Consumer registration requires explicit unified source configuration."
    );
  let selection: MarketplaceConsumerSelection;
  if (consumer === "bnb-discovery") {
    if (!env.bnbDiscoveryStartBlock)
      throw new Error("Configure the explicit BNB discovery launch block.");
    selection = {
      kind: "bnb-discovery",
      policy: env.productionTrading?.bnb
        ? buildProductionBnbPolicy(env.productionTrading.bnb)
        : bnbValidationPolicy,
      launchBlock: env.bnbDiscoveryStartBlock
    };
  } else if (consumer === "bnb-sales")
    selection = {
      kind: "bnb-sales",
      config: sharedBnbSaleRuntimeConfiguration(env.deployment)
    };
  else {
    const sale = readSaleReplayEnvironment();
    if (consumer !== `collection-sales:${sale.chain}`)
      throw new Error("Consumer differs from the configured sale chain.");
    const policy = (
      await pool.query<{
        start_block: string;
        confirmations: number;
        policy: string;
      }>(
        "SELECT start_block::text,confirmations,policy FROM yunipals_market.sale_replay_config WHERE chain_id=$1",
        [marketplaceChains[sale.chain].chainId]
      )
    ).rows[0];
    if (!policy || policy.policy !== sale.policy)
      throw new Error(
        "Configure the exact owner-selected sale policy before registration."
      );
    selection = {
      kind: "collection-sales",
      config: {
        chain: sale.chain,
        startBlock: policy.start_block,
        confirmations: policy.confirmations,
        policy: policy.policy,
        confirmationPolicy:
          sale.chain === "base"
            ? { kind: "latest" }
            : { kind: "depth", subsequentBlocks: policy.confirmations }
      }
    };
  }
  console.log(
    JSON.stringify(
      await selectSharedMarketplaceConsumer(
        pool,
        shared.reader,
        selection,
        review
      )
    )
  );
} catch {
  console.error(
    "Marketplace consumer selection failed; verify source/configuration/cursor and review again. No secrets were logged."
  );
  process.exitCode = 1;
} finally {
  await shared?.pool.end();
  await pool.end();
}
