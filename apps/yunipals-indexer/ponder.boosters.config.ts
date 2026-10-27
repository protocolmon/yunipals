import { createConfig } from "ponder";
import { boosterContracts, boosterDeployment } from "./lib/boosters/config.js";
import { baseRpcUrlOf } from "./lib/rpc.js";

if (process.env.PONDER_BOOSTERS_ONLY !== "true")
  throw new Error(
    "Use PONDER_BOOSTERS_ONLY=true for isolated booster indexing"
  );
if (!boosterDeployment())
  throw new Error(
    "Configure booster deployment addresses before starting its indexer"
  );

export default createConfig({
  database: { kind: "postgres" },
  chains: { base: { id: 8453, rpc: baseRpcUrlOf(), pollingInterval: 2000 } },
  contracts: boosterContracts()
});
