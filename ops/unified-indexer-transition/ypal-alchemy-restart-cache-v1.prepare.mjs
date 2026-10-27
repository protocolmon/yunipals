#!/usr/bin/env node
// Offline-only derivation of genuine71e Ponder event filters/fragments.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const SOURCE = path.join(
  ROOT,
  "ops/unified-indexer-transition/ypal-bnb-cost-study-v1.mjs"
);
const raw = await readFile(SOURCE, "utf8"),
  sha = (b) => createHash("sha256").update(b).digest("hex");
assert.equal(
  sha(raw),
  "2e82a014600971f83dc0bc5dee2063c0ba00116011ee460783a65afca81a34e7"
);
const runtimeFiles = {
  "package.json":
    "e280124810f611e6f7f5b1d61b49880864ecb23906f4719bc35aa2e92ce8c8f8",
  "dist/esm/runtime/index.js":
    "448627d62cd63f08e70ed65a573b2731eab91942cd78a802241538e89c35b0cf",
  "dist/esm/runtime/fragments.js":
    "452d578d276ac3d2838491e8ed3b476aba13e106595fe1cdee891f13225c49d0",
  "dist/esm/runtime/filter.js":
    "04cbfd1937d9fc4e006ce3107f259364e163a2e0e83ae7c7c304e55550bf6d57",
  "dist/esm/runtime/multichain.js":
    "cab4c2f8b1a0e403ceac5c12abf2b97da6885d54273430af5296f333ae2533ee",
  "dist/esm/runtime/historical.js":
    "9ff112e17a18f60cdb8aa6125882d7d0a3e99f36635de5ace7ea52cc9c944028",
  "dist/esm/build/config.js":
    "ffc870eff2037ebd59224f6a0bc501019b5c34333b0735bfdb415d9b3ffd7c48",
  "dist/esm/utils/interval.js":
    "28632d16c313091195ffb1c7f4fb6a11f2692c4051ea7380a670e7904832d106",
  "dist/esm/utils/checkpoint.js":
    "9dab46c7bf976109b0285267e2841da8ce6a89099ae3bfc290347c270709c833",
  "dist/esm/internal/options.js":
    "569e623f54c636cda3f19d0a94845c097d5363c54f172c3c3a677a19fc0ae340",
  "dist/esm/sync-store/index.js":
    "9782ea1d9f067ae78eeae308a30e044020557fcfe069dac7cbc7edca57af1368",
  "dist/esm/sync-store/schema.js":
    "af6db570ec965e53bcefe70fd2ceb42cb2040f2505d4255d1c93fdb1ef0f35ac",
  "dist/esm/database/index.js":
    "cd51e275d4ef2034038070e5f517a858e78ac07cd5e6c46adc0add24782aa3b8",
  "dist/esm/rpc/actions.js":
    "a34e95a4d965d9156b9a5ab7106ec795083981e8efab20502830bbd47b16c70a"
};
const ponderRoot = await realpath(
  path.join(ROOT, "apps/yunipals-indexer/node_modules/ponder")
);
for (const [file, pin] of Object.entries(runtimeFiles))
  assert.equal(sha(await readFile(path.join(ponderRoot, file))), pin, file);
let code = raw;
function once(a, b) {
  assert.equal(code.split(a).length, 2, a);
  code = code.replace(a, b);
}
once(
  'const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");',
  "const ROOT = " + JSON.stringify(ROOT) + ";"
);
once(
  'new URL("./ypal-bnb-cost-study-v1.ponder-files.json", import.meta.url)',
  "new URL(" +
    JSON.stringify(
      pathToFileURL(
        path.join(
          ROOT,
          "ops/unified-indexer-transition/ypal-bnb-cost-study-v1.ponder-files.json"
        )
      ).href
    ) +
    ")"
);
once(
  "const hashes = []; let config, handler;",
  "const hashes = []; let config, handler, indexingFunctions;"
);
once(
  'if (method === "executeIndexingFunctions") handler = value.result.indexingFunctions.find(v => v.name === "BnbCheckpoint:block").fn;',
  'if (method === "executeIndexingFunctions") { indexingFunctions=value.result.indexingFunctions;handler = indexingFunctions.find(v => v.name === "BnbCheckpoint:block").fn; }'
);
once(
  'return { buildId: sha("2" + hashes.join("")).slice(0, 10), configHash:',
  `const {buildConfig,buildIndexingFunctions}=await internal('./build/config.js');
    const {getFragments}=await internal('./runtime/fragments.js');
    const configBuild=buildConfig({common,config});
    const built=await buildIndexingFunctions({common,config,indexingFunctions,configBuild:{...configBuild,rpcs:configBuild.chains.map(()=>({request:async({method,params})=>{assert.equal(method,'eth_getBlockByNumber');return block(params[0]==='latest'?1000000000:Number(BigInt(params[0])));}}))}});
    const filters=built.eventCallbacks.flat().map(callback=>{const f=callback.filter;assert(['log','block'].includes(f.type));
      if(f.type==='log')assert(typeof f.address==='string'||Array.isArray(f.address)&&f.address.every(v=>typeof v==='string'));const fragments=getFragments(f);
      return {callback:callback.name,filter:{...f,fromBlock:f.type==='block'?'latest':f.fromBlock},fragments};});
    assert.equal(filters.filter(v=>v.filter.type==='block').length,4);
    return { compiledFilters:filters, buildId: sha("2" + hashes.join("")).slice(0, 10), configHash:`
);
once("async function builds() {", "export async function builds() {");
const tmp = await mkdtemp("/tmp/yunipals-alchemy-restart-filter-build-");
const worker = path.join(tmp, "offline-worker.mjs");
await writeFile(worker, code);
// The frozen builder owns its separate copied public workspace and supplies all
// fake responses. It cannot open real sockets or a database.
const { builds } = await import(pathToFileURL(worker));
const buildsReport = await builds();
const base = buildsReport.variants.baseline;
assert.equal(base.buildId, "71e2a7f3b7");
assert.equal(base.socketAttempts, 0);
assert.equal(base.databaseConnections, 0);
const filters = base.compiledFilters;
assert(
  filters
    .filter((v) => v.filter.type === "block")
    .every((v) => v.filter.interval === 1)
);
const result = {
  format: "yunipals-alchemy-restart-official-filters-v1",
  buildId: base.buildId,
  configHash: base.configHash,
  schemaHash: base.schemaHash,
  indexingHash: base.indexingHash,
  publicSourceExportSha256: buildsReport.publicSourceExportSha256,
  frozenOfflineBuilderSha256: sha(raw),
  syntheticHeadersUsedOnlyToResolveLatest: true,
  latestBlockFiltersRemainSymbolic: true,
  filters,
  runtimeFiles,
  contracts: base.contracts,
  filterCount: filters.length,
  logFilters: filters.filter((x) => x.filter.type === "log").length,
  blockFilters: 4,
  fragmentCount: filters.reduce((n, x) => n + x.fragments.length, 0),
  providerCalls: 0,
  databaseConnections: 0,
  socketAttempts: 0
};
const output = process.argv[2];
assert(output?.startsWith("/tmp/"));
await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(
  JSON.stringify({
    output,
    sha256: sha(await readFile(output)),
    filterCount: result.filterCount,
    fragmentCount: result.fragmentCount,
    buildId: result.buildId,
    providerCalls: 0,
    databaseConnections: 0
  })
);
