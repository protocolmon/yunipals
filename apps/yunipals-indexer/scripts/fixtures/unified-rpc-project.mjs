import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const once = (source, before, after) => {
  assert.equal(
    source.split(before).length,
    2,
    `Fixture substitution changed: ${before}`
  );
  return source.replace(before, after);
};

/** Configuration-only fixture: copy production handlers/schema, scope their
 * registrations to one actual Base RPC chain, and change deployment starts.
 * No handler body, schema, Ponder runtime or RPC response is replaced. */
export async function createUnifiedRpcProject({
  repository,
  directory,
  startBlock,
  budgetProxy = false
}) {
  const source = join(repository, "apps/yunipals-indexer");
  const root = join(directory, "apps/yunipals-indexer");
  await mkdir(root, { recursive: true });
  await Promise.all([
    cp(join(source, "lib"), join(root, "lib"), { recursive: true }),
    cp(join(source, "src"), join(root, "src"), { recursive: true }),
    cp(join(source, "ponder.schema.ts"), join(root, "ponder.schema.ts")),
    cp(join(source, "ponder-env.d.ts"), join(root, "ponder-env.d.ts")),
    cp(join(source, "tsconfig.json"), join(root, "tsconfig.json")),
    symlink(join(repository, "packages"), join(directory, "packages"), "dir"),
    symlink(join(source, "node_modules"), join(root, "node_modules"), "dir")
  ]);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" })
  );
  await writeFile(
    join(root, "vite.config.ts"),
    `export default {server:{fs:{allow:${JSON.stringify([repository, directory])}}}};\n`
  );
  const transformations = [];
  async function transform(path, edit, reason) {
    const bytes = await readFile(join(source, path)),
      changed = edit(bytes.toString("utf8"));
    await writeFile(join(root, path), changed);
    transformations.push({
      path,
      reason,
      sourceSha256: sha256(bytes),
      fixtureSha256: sha256(changed)
    });
  }
  await transform(
    "lib/constants.ts",
    (text) =>
      once(
        once(
          text,
          "deploymentBlock: 22_224_075",
          `deploymentBlock: ${startBlock}`
        ),
        "deploymentBlock: 52_587_956",
        `deploymentBlock: ${startBlock}`
      ),
    "Fixture Base ownership/Islands deployment starts"
  );
  await transform(
    "lib/unified/sources.ts",
    (text) =>
      once(
        text,
        "sources: sources.sort((a, b) => a.id.localeCompare(b.id))",
        "sources: sources.filter(source => source.chainId === 8453).sort((a, b) => a.id.localeCompare(b.id))"
      ),
    "Manifest scope is Base only"
  );
  await transform(
    "src/index.ts",
    (text) =>
      [
        '  registerCollection("YunipalsEthereum", "ethereum");\n',
        '  registerCollection("YunipalsPolygon", "polygon");\n',
        '  registerCollection("YunipalsBnb", "bnb");\n'
      ].reduce((value, line) => once(value, line, ""), text),
    "Register only the Base ownership setup/handler family"
  );
  await transform(
    "src/unified.ts",
    (text) =>
      [
        '    "EthereumCheckpoint",\n',
        '    "PolygonCheckpoint",\n',
        '    "BnbCheckpoint"\n'
      ].reduce((value, line) => once(value, line, ""), text),
    "Register only the actual Base block source"
  );
  const unchanged = [];
  for (const path of [
    "src/arena.ts",
    "src/boosters.ts",
    "ponder.schema.ts",
    "lib/arena/state.ts",
    "lib/ownership/transfer.ts",
    "lib/unified/handlers.ts",
    "lib/unified/schema.ts",
    "lib/boosters/schema.ts"
  ]) {
    const original = await readFile(join(source, path)),
      fixture = await readFile(join(root, path));
    assert.deepEqual(fixture, original);
    unchanged.push({ path, sha256: sha256(original) });
  }
  await writeFile(
    join(root, "ponder.config.ts"),
    `
import { createConfig } from "ponder";
import { collectionAbi, islandsAbi, baseIslandsAbi } from "./lib/abi.js";
import { collections, baseIslandCollection } from "./lib/constants.js";
import { boosterContracts } from "./lib/boosters/config.js";
import { baseMetadataAbi } from "./lib/metadata/base-abi.js";
import { arenaAbi } from "../../packages/yunipals-market-core/src/arenaAbi.js";
import { seaportEventAbi } from "../../packages/yunipals-market-core/src/seaportEvents.js";
${budgetProxy ? 'import { preflightUnifiedRpc, unifiedRpcTransport } from "./lib/unified/rpc-preflight.js";\nimport { buildSourceManifest } from "./lib/unified/sources.js";\nawait preflightUnifiedRpc(buildSourceManifest(),process.env,{endpoints:{8453:process.env.PONDER_RPC_URL_8453}});' : ""}
const startBlock=${startBlock};
const disabled=(abi)=>({chain:"base",abi,address:[],startBlock});
export default createConfig({
 database:{kind:"postgres",poolConfig:{max:8}},ordering:"multichain",
 chains:{base:{id:8453,rpc:${budgetProxy ? "unifiedRpcTransport(8453)" : "process.env.PONDER_RPC_URL_8453"},pollingInterval:250}},
 blocks:{BaseCheckpoint:{chain:"base",startBlock,interval:1}},
 contracts:{
  ...boosterContracts(),
  YunipalsBase:{chain:"base",abi:collectionAbi,address:collections.base.address,startBlock,includeTransactionReceipts:${!budgetProxy}},
  YunipalsBaseMetadata:{chain:"base",abi:baseMetadataAbi,address:collections.base.address,startBlock,includeTransactionReceipts:${!budgetProxy}},
  YunipalsBaseIslandsV2:{chain:"base",abi:baseIslandsAbi,address:baseIslandCollection.address,startBlock,includeTransactionReceipts:${!budgetProxy}},
  YunipalsArena:{chain:"base",abi:arenaAbi,address:process.env.ARENA_CONTRACT,startBlock,includeTransactionReceipts:${!budgetProxy}},
  YunipalsEthereum:disabled(collectionAbi),YunipalsPolygon:disabled(collectionAbi),YunipalsBnb:disabled(collectionAbi),
  YunipalsIslands:disabled(islandsAbi),BnbSeaport:disabled(seaportEventAbi)
 }
});
`
  );
  return {
    root,
    transformations,
    unchanged,
    configSha256: sha256(await readFile(join(root, "ponder.config.ts")))
  };
}

/** Tiny local-only EVM contract. Calldata is [topic count, data length,
 * four topic words, data]. LOG0..LOG4 execute inside Anvil, so receipts, blooms,
 * block hashes and reorgs come from a real EVM/RPC rather than a handler feed. */
export function logEmitterBytecode(afterLogCall) {
  if (afterLogCall) {
    assert.match(afterLogCall.address, /^0x[0-9a-f]{40}$/i);
    assert.match(afterLogCall.selector, /^0x[0-9a-f]{8}$/i);
  }
  const bytes = [],
    fixups = [],
    labels = new Map();
  const push = (value) => bytes.push(0x60, value);
  for (let count = 0; count <= 4; count++) {
    push(0);
    bytes.push(0x35);
    push(count);
    bytes.push(0x14, 0x61);
    fixups.push({ at: bytes.length, label: count });
    bytes.push(0, 0, 0x57);
  }
  push(0);
  push(0);
  bytes.push(0xfd);
  for (let count = 0; count <= 4; count++) {
    labels.set(count, bytes.length);
    bytes.push(0x5b);
    push(32);
    bytes.push(0x35);
    push(192);
    push(0);
    bytes.push(0x37);
    for (let index = count - 1; index >= 0; index--) {
      push(64 + index * 32);
      bytes.push(0x35);
    }
    push(32);
    bytes.push(0x35);
    push(0);
    bytes.push(0xa0 + count);
    if (afterLogCall) {
      bytes.push(0x63, ...Buffer.from(afterLogCall.selector.slice(2), "hex"));
      push(224);
      bytes.push(0x1b);
      push(0);
      bytes.push(0x52);
      push(0);
      push(0);
      push(4);
      push(0);
      push(0);
      bytes.push(
        0x73,
        ...Buffer.from(afterLogCall.address.slice(2), "hex"),
        0x5a,
        0xf1,
        0x15,
        0x61
      );
      fixups.push({ at: bytes.length, label: "call_failed" });
      bytes.push(0, 0, 0x57);
    }
    bytes.push(0x00);
  }
  if (afterLogCall) {
    labels.set("call_failed", bytes.length);
    bytes.push(0x5b);
    push(0);
    push(0);
    bytes.push(0xfd);
  }
  for (const fixup of fixups) {
    const offset = labels.get(fixup.label);
    bytes[fixup.at] = offset >> 8;
    bytes[fixup.at + 1] = offset & 255;
  }
  return `0x${Buffer.from(bytes).toString("hex")}`;
}
