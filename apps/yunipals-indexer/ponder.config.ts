import { createConfig } from "ponder";
import { collectionAbi, islandsAbi, baseIslandsAbi } from "./lib/abi.js";
import {
  collections,
  islandCollection,
  baseIslandCollection
} from "./lib/constants.js";
import { baseRpcUrlOf, bnbRpcUrlOf, polygonRpcUrlOf } from "./lib/rpc.js";
import { boosterContracts } from "./lib/boosters/config.js";
import { baseMetadataAbi } from "./lib/metadata/base-abi.js";
import {
  arenaSourceDeployments,
  buildSourceManifest
} from "./lib/unified/sources.js";
import { arenaAbi } from "../../packages/yunipals-market-core/src/arenaAbi.js";
import { seaportEventAbi } from "../../packages/yunipals-market-core/src/seaportEvents.js";
import type { Address } from "viem";
import {
  preflightUnifiedRpc,
  unifiedRpcTransport
} from "./lib/unified/rpc-preflight.js";

if (process.env.PONDER_ISLANDS_ONLY === "true") {
  throw new Error(
    "PONDER_ISLANDS_ONLY requires --config ponder.islands.config.ts"
  );
}
if (process.env.PONDER_BOOSTERS_ONLY === "true") {
  throw new Error(
    "PONDER_BOOSTERS_ONLY requires --config ponder.boosters.config.ts"
  );
}
const ethereumRpcUrl = process.env.PONDER_RPC_URL_1;
const baseRpcUrl = baseRpcUrlOf();
const polygonRpcUrl = polygonRpcUrlOf();
if (!ethereumRpcUrl) throw new Error("PONDER_RPC_URL_1 is required");
const sourceManifest = buildSourceManifest();
await preflightUnifiedRpc(sourceManifest);
const arenas = arenaSourceDeployments();
const seaport = sourceManifest.sources.find(
  (source) => source.id === "marketplace:bnb:seaport"
)!;
const baseIslands = sourceManifest.sources.find(
  (source) => source.id === "islands:base:v2"
)!;

export default createConfig({
  database: { kind: "postgres" },
  ordering: "multichain",
  chains: {
    mainnet: {
      id: 1,
      rpc: unifiedRpcTransport(1) ?? ethereumRpcUrl,
      pollingInterval: 12_000
    },
    base: {
      id: 8_453,
      rpc: unifiedRpcTransport(8453) ?? baseRpcUrl,
      pollingInterval: 2_000
    },
    polygon: {
      id: 137,
      rpc: unifiedRpcTransport(137) ?? polygonRpcUrl,
      pollingInterval: 30_000
    },
    bnb: {
      id: 56,
      rpc: unifiedRpcTransport(56) ?? bnbRpcUrlOf(),
      pollingInterval: 2_000
    }
  },
  // Live block callbacks bind processed state to a hash even on quiet sources.
  // Starting at latest avoids scanning every block of historical chain data.
  blocks: {
    EthereumCheckpoint: { chain: "mainnet", startBlock: "latest", interval: 1 },
    BaseCheckpoint: { chain: "base", startBlock: "latest", interval: 1 },
    PolygonCheckpoint: { chain: "polygon", startBlock: "latest", interval: 1 },
    BnbCheckpoint: { chain: "bnb", startBlock: "latest", interval: 1 }
  },
  contracts: {
    ...boosterContracts(),
    YunipalsBnb: {
      chain: "bnb",
      abi: collectionAbi,
      address: collections.bnb.address,
      startBlock: collections.bnb.deploymentBlock
    },
    YunipalsBaseMetadata: {
      chain: "base",
      abi: baseMetadataAbi,
      address: collections.base.address,
      startBlock: collections.base.deploymentBlock
    },
    YunipalsBaseIslandsV2: {
      chain: "base",
      abi: baseIslandsAbi,
      address: baseIslands.enabled
        ? baseIslandCollection.address
        : ([] as Address[]),
      startBlock: baseIslands.enabled ? baseIslandCollection.deploymentBlock : 0
    },
    YunipalsArena: {
      chain: "base",
      abi: arenaAbi,
      address: arenas.map((deployment) => deployment.address),
      startBlock: arenas.length
        ? Math.min(...arenas.map((deployment) => deployment.startBlock))
        : 0
    },
    BnbSeaport: {
      chain: "bnb",
      abi: seaportEventAbi,
      address: seaport.enabled
        ? (seaport.address as Address)
        : ([] as Address[]),
      startBlock: seaport.startBlock === null ? 0 : Number(seaport.startBlock)
    },
    YunipalsIslands: {
      chain: "mainnet",
      abi: islandsAbi,
      address: islandCollection.address,
      startBlock: islandCollection.deploymentBlock
    },
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
