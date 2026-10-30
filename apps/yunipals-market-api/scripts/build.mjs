import { mkdir, readFile } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });
const { dependencies } = JSON.parse(await readFile("package.json", "utf8"));
await build({
  entryPoints: {
    "arena-anime-rehearsal": "src/arena/live/animeRehearsal.ts",
    "arena-anime-monitor": "src/arena/live/animeMonitorWorker.ts",
    "arena-anime-deployment": "src/arena/live/animeDeployment.ts",
    "arena-anime-media": "src/arena/live/animeMediaWorker.ts",
    "arena-anime-studio": "src/arena/live/animeStudio.ts",
    "arena-monitor": "src/arena/live/healthWorker.ts",
    "arena-recovery": "src/arena/live/recoveryCli.ts",
    "arena-inspect": "src/arena/live/inspect.ts",
    "arena-native-inspect": "src/arena/live/nativeInspect.ts",
    "arena-native-disclosure": "src/arena/live/nativeDisclosureWorker.ts",
    "arena-native-referee": "src/arena/live/nativeRefereeWorker.ts",
    "arena-native-media": "src/arena/live/nativeMediaWorker.ts",
    "arena-media-adoption": "src/arena/live/mediaAdoptionCli.ts",
    "arena-source-switch": "src/arena/live/sourceSwitchCli.ts",
    "arena-native-client": "src/arena/live/nativeClientWorker.ts",
    "arena-native-execution": "src/arena/live/nativeExecutionWorker.ts",
    "arena-server": "src/arena/live/server.ts",
    "arena-projector": "src/arena/live/projectorWorker.ts",
    "arena-referee": "src/arena/live/refereeWorker.ts",
    "arena-settlement": "src/arena/live/settlementWorker.ts",
    "arena-control": "src/arena/live/controlWorker.ts",
    "arena-capacity": "src/arena/live/capacityWorker.ts",
    "arena-lobby": "src/arena/live/lobbyWorker.ts",
    "arena-media": "src/arena/live/mediaWorker.ts",
    "arena-migrate": "src/arena/live/migrate.ts",
    server: "src/server.ts",
    migrate: "src/migrate.ts",
    "migration-history": "src/migrationHistory.ts",
    worker: "src/worker.ts",
    "sale-worker": "src/saleWorker.ts",
    "marketplace-consumer": "src/indexer/consumerSelectionCli.ts",
    "marketplace-rollback": "src/indexer/consumerRollbackCli.ts",
    "opensea-probe": "src/openseaProbe.ts",
    "opensea-discovery": "src/openseaDiscovery.ts",
    "opensea-worker": "src/openseaWorker.ts",
    "opensea-read-worker": "src/openseaReadWorker.ts",
    "opensea-signature-worker": "src/openseaSignatureWorker.ts",
    "opensea-signature-fleet": "src/openseaSignatureFleet.ts",
    "opensea-stream": "src/openseaStream.ts",
    "rpc-budget-proxy": "src/rpcBudgetProxy.ts",
    "owner-trade-authorization": "src/ownerTradeAuthorizationCli.ts"
  },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // Bundle shared workspace TypeScript; deployed runtime dependencies stay external.
  external: Object.keys(dependencies).filter(
    (name) =>
      ![
        "@protopals/yunipals-market-core",
        "@protopals/yunipals-indexer-server"
      ].includes(name)
  ),
  sourcemap: true
});
