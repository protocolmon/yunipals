import { parseArgs } from "node:util";

import { createPool } from "@/db/pool";
import { readEnvironment } from "@/environment";
import { bnbValidationPolicy } from "@/bnb/validation";
import { buildProductionBnbPolicy } from "@/productionRuntime";
import {
  selectLegacyMarketplaceConsumer,
  type LegacyMarketplaceSelection
} from "./consumerRollback";

async function main() {
  const { values } = parseArgs({
    options: {
      consumer: { type: "string" },
      "start-block": { type: "string" },
      confirmations: { type: "string" },
      policy: { type: "string" },
      finality: { type: "string" },
      apply: { type: "string" }
    }
  });
  if (!process.env.MARKET_MIGRATION_DATABASE_URL)
    throw new Error("Explicit migration owner connection required.");
  if (values.apply && !/^0x[0-9a-f]{64}$/.test(values.apply))
    throw new Error("Exact reviewed hash required.");
  const env = readEnvironment({
    ...process.env,
    MARKET_DATABASE_URL: process.env.MARKET_MIGRATION_DATABASE_URL
  });
  let selection: LegacyMarketplaceSelection;
  if (values.consumer === "bnb-discovery" || values.consumer === "bnb-sales") {
    if (
      values["start-block"] ||
      values.confirmations ||
      values.policy ||
      values.finality
    )
      throw new Error(
        "BNB uses its existing deployment policy/launch configuration."
      );
    if (values.consumer === "bnb-sales")
      selection = { kind: "bnb-sales", deployment: env.deployment };
    else {
      if (!env.bnbDiscoveryStartBlock)
        throw new Error("Explicit discovery launch block required.");
      selection = {
        kind: "bnb-discovery",
        launchBlock: env.bnbDiscoveryStartBlock,
        policy: env.productionTrading?.bnb
          ? buildProductionBnbPolicy(env.productionTrading.bnb)
          : bnbValidationPolicy
      };
    }
  } else {
    const chain = values.consumer?.replace(/^collection-sales:/, "");
    if (
      !["ethereum", "base", "polygon"].includes(chain ?? "") ||
      values.consumer !== `collection-sales:${chain}` ||
      !values["start-block"] ||
      !values.confirmations ||
      !/^[1-9][0-9]*$/.test(values.confirmations) ||
      !values.policy ||
      (values.finality !== "finalized" && values.finality !== "confirmations")
    ) {
      throw new Error(
        "Use --consumer collection-sales:<chain> --start-block N --confirmations N --policy LABEL --finality finalized|confirmations [--apply REVIEW_HASH]."
      );
    }
    if (env.deployment === "production" && values.finality !== "finalized")
      throw new Error(
        "The compatible production sale worker retains finalized-tag semantics."
      );
    selection = {
      kind: "collection-sales",
      chain: chain as "ethereum" | "base" | "polygon",
      startBlock: values["start-block"],
      confirmations: Number(values.confirmations),
      policy: values.policy,
      finality: values.finality
    };
  }
  const pool = createPool(env);
  try {
    console.log(
      JSON.stringify(
        await selectLegacyMarketplaceConsumer(pool, selection, values.apply)
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error(
    "Marketplace rollback failed; verify owner/configuration/current cursor and obtain a fresh review. No secrets were logged."
  );
  process.exitCode = 1;
});
