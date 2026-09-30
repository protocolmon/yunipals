import { createConfig } from "ponder";
import { collectionAbi } from "./lib/abi.js";
import { collections } from "./lib/constants.js";
import { baseRpcUrlOf, polygonRpcUrlOf } from "./lib/rpc.js";

const ethereumRpcUrl = process.env.PONDER_RPC_URL_1;
const baseRpcUrl = baseRpcUrlOf();
const polygonRpcUrl = polygonRpcUrlOf();
if (!ethereumRpcUrl) throw new Error("PONDER_RPC_URL_1 is required");

export default createConfig({
  database: { kind: "postgres" },
  chains: {
    mainnet: {
      id: 1,
      rpc: ethereumRpcUrl,
      pollingInterval: 12_000
    },
    base: {
      id: 8_453,
      rpc: baseRpcUrl,
      pollingInterval: 2_000
    },
    polygon: {
      id: 137,
      rpc: polygonRpcUrl,
      pollingInterval: 30_000
    }
  },
  contracts: {
    YunipalsEthereum: {
      chain: "mainnet",
      abi: collectionAbi,
      address: collections.ethereum.address,
      startBlock: collections.ethereum.deploymentBlock
    },
    YunipalsBase: {
      chain: "base",
      abi: collectionAbi,
      address: collections.base.address,
      startBlock: collections.base.deploymentBlock
    },
    YunipalsPolygon: {
      chain: "polygon",
      abi: collectionAbi,
      address: collections.polygon.address,
      startBlock: collections.polygon.deploymentBlock
    }
  }
});
