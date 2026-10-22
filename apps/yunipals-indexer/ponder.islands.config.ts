import { createConfig } from "ponder";
import { islandsAbi } from "./lib/abi.js";
import { islandCollection } from "./lib/constants.js";

if (process.env.PONDER_ISLANDS_ONLY !== "true") {
  throw new Error(
    "The isolated Islands config requires PONDER_ISLANDS_ONLY=true"
  );
}
const rpc = process.env.PONDER_RPC_URL_1;
if (!rpc) throw new Error("PONDER_RPC_URL_1 is required");

export default createConfig({
  database: { kind: "postgres" },
  chains: {
    mainnet: {
      id: 1,
      rpc,
      pollingInterval: 12_000,
      ethGetLogsBlockRange: 100_000
    }
  },
  contracts: {
    YunipalsIslands: {
      chain: "mainnet",
      abi: islandsAbi,
      address: islandCollection.address,
      startBlock: islandCollection.deploymentBlock
    }
  }
});
