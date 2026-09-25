import { mkdir, readFile } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });
const { dependencies } = JSON.parse(await readFile("package.json", "utf8"));
await build({
  entryPoints: {
    server: "src/server.ts",
    migrate: "src/migrate.ts",
    "migration-history": "src/migrationHistory.ts",
    worker: "src/worker.ts",
    "sale-worker": "src/saleWorker.ts",
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
    (name) => name !== "@protopals/yunipals-market-core"
  ),
  sourcemap: true
});
