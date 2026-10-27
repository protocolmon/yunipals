// Read-only chain qualification and public candidate files. No host apply mode.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { lstat, mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(
  resolve(ROOT, "apps/yunipals-home-web/package.json")
);
const {
  createPublicClient,
  http,
  encodeDeployData,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbiParameters,
  parseAbi,
  getContractAddress,
  hashDomain,
  isAddress,
  keccak256,
  padHex,
  parseEventLogs
} = require("viem");
export const PACKAGE_SHA =
  "12bad482e7f34aa0dcc51033ee115b177bac4874181b4b522513adf2a3944886";
export const ABI_SHA =
  "580b38c39dc3e76f92762195f4b6862123775f13d95d092b3fafa39d73adc0ba";
export const ARTWORK_MANIFEST_SHA =
  "79e85ccfa753bb81d8115a17e963f3b427e276f5e68b24d0a3ee284d85c3c2bf";
export const PROFILE =
  "0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728";
export const SCHEMA = "yunipals_boosters_ypal_v1";
export const SOURCE_UNIT = "yunipals-booster-ypal-source.service";
export const SOURCE_ROOT =
  "/var/lib/yunipals-booster-ypal/base-ypal-v1-source008";
export const PUBLIC_ENV = "/etc/yunipals-unified/booster-ypal.public.env";
export const OPS = "/opt/yunipals-unified/operations/free-replay-20261020";
export const SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const STEPS = [
  "ypal",
  "registryImplementation",
  "registry",
  "monstersImplementation",
  "monsters",
  "engineImplementation",
  "engine",
  "metadata",
  "configure",
  "activate"
];
export const TABLES = [
  "_ponder_meta",
  "_ponder_checkpoint",
  "booster_type",
  "booster_original",
  "booster_request",
  "booster_monster",
  "booster_refund",
  "booster_engine_state",
  "booster_checkpoint",
  "booster_event"
].sort();
const OWNER = "0xb3883cd96d72b08b8226452305a28d65974a3727";
const OLD = [
  "0xeaee2da120a398f21729d50672ac5d1dd71d7274",
  "0x105319be2182018c31fb10b1be198c3cf238a146",
  "0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609",
  "0xe5a54a517cde8ed48a336b173044b1138aa2c1a3"
];
const sha = (v) => createHash("sha256").update(v).digest("hex");
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const json = (v) =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2) +
  "\n";
const number = (v) =>
  typeof v === "string" &&
  /^[1-9][0-9]{0,15}$/.test(v) &&
  Number.isSafeInteger(Number(v));
const hex32 = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
const address = (v) => isAddress(v ?? "") && !/^0x0{40}$/i.test(v);
const adminAbi = parseAbi([
  "function hasRole(bytes32,address) view returns(bool)",
  "function proxiableUUID() view returns(bytes32)",
  "function registry() view returns(address)",
  "function monsters() view returns(address)",
  "function wrapper() view returns(address)",
  "function MAX_OPEN_PACKS() view returns(uint32)",
  "function PERMIT_OPEN_VERSION() view returns(uint256)",
  "function requestsPaused() view returns(bool)",
  "function tokenMetadataBaseURI() view returns(string)",
  "function setTokenMetadataBaseURI(string)"
]);
const tokenAbi = parseAbi([
  "function pmon() view returns(address)",
  "function burnAddress() view returns(address)",
  "function owner() view returns(address)",
  "function isLocked() view returns(bool)",
  "function name() view returns(string)",
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
  "function DOMAIN_SEPARATOR() view returns(bytes32)",
  "function nonces(address) view returns(uint256)"
]);
const DOMAIN_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
  ]
};

export async function inputs(packageRaw) {
  assert.equal(
    sha(packageRaw),
    PACKAGE_SHA,
    "exact reviewed fresh package required"
  );
  const bundle = JSON.parse(packageRaw);
  assert.equal(bundle.format, "yunipals-ypal-fresh-launch-v1");
  const raw = await readFile(
    resolve(ROOT, "packages/yunipals-market-core/src/boosterAbi.ts")
  );
  assert.equal(sha(raw), ABI_SHA, "frozen indexing event ABI required");
  const { packRegistryAbi } = await import(
    "../../packages/yunipals-market-core/src/boosterAbi.ts"
  );
  return { bundle, packRegistryAbi };
}

export function catalogHash(bundle) {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "(uint32[] types,uint32[] colors,uint32[] horns,uint32[] glitters,uint32[] allowed)"
      ),
      [bundle.pack.catalog]
    )
  );
}
export function rules(bundle, d) {
  const p = bundle.pack;
  return {
    engine: d.engine,
    paymentToken: d.ypal,
    price: BigInt(p.priceRaw),
    intervalSeconds: BigInt(p.intervalSeconds),
    mintsPerInterval: p.mintsPerInterval,
    maxBatch: p.maxBatch,
    baseGas: p.baseGas,
    perMintGas: p.perMintGas,
    confirmations: p.confirmations,
    supplyCap: BigInt(p.supplyCap),
    artworkHash: p.artworkHash,
    manifestURI: p.manifestURI,
    metadataBaseURI: p.metadataBaseURI
  };
}
export function runtime(artifact, actual, pmon) {
  let code = artifact.runtimeTemplate;
  for (const r of artifact.immutableReferences) {
    const start = 2 + r.offset * 2;
    assert.equal(code.slice(start, start + 64), "0".repeat(64));
    code =
      code.slice(0, start) +
      padHex(r.value === "pmon" ? pmon : actual, { size: 32 })
        .slice(2)
        .toLowerCase() +
      code.slice(start + 64);
  }
  return code;
}
export function action(bundle, abi, d, step) {
  const artifact = {
    ypal: "ypal",
    registryImplementation: "registry",
    monstersImplementation: "monsters",
    engineImplementation: "engine"
  }[step];
  if (step === "ypal")
    return {
      to: null,
      data: encodeDeployData({
        abi: parseAbi(["constructor(address,address)"]),
        bytecode: bundle.artifacts.ypal.creationBytecode,
        args: [bundle.pmon, bundle.burnAddress]
      })
    };
  if (artifact)
    return { to: null, data: bundle.artifacts[artifact].creationBytecode };
  if (["registry", "monsters", "engine"].includes(step)) {
    const init =
      step === "registry"
        ? ["function initialize(address)", [bundle.owner]]
        : step === "monsters"
          ? ["function initialize(address,address)", [bundle.owner, d.registry]]
          : [
              "function initialize(address,address,address,address)",
              [bundle.owner, d.registry, d.monsters, bundle.vrfWrapper]
            ];
    return {
      to: null,
      data: encodeDeployData({
        abi: parseAbi(["constructor(address,bytes)"]),
        bytecode: bundle.artifacts.proxy.creationBytecode,
        args: [
          d.implementations[step],
          encodeFunctionData({
            abi: parseAbi([init[0]]),
            functionName: "initialize",
            args: init[1]
          })
        ]
      })
    };
  }
  if (step === "metadata")
    return {
      to: d.monsters,
      data: encodeFunctionData({
        abi: adminAbi,
        functionName: "setTokenMetadataBaseURI",
        args: [d.metadataBaseURI]
      })
    };
  if (step === "configure")
    return {
      to: d.registry,
      data: encodeFunctionData({
        abi,
        functionName: "configureType",
        args: [0n, rules(bundle, d), bundle.pack.catalog]
      })
    };
  assert.equal(step, "activate");
  return {
    to: d.registry,
    data: encodeFunctionData({ abi, functionName: "activate", args: [1n] })
  };
}

export function manifest(bundle, value) {
  assert.deepEqual(
    Object.keys(value).sort(),
    [
      "format",
      "launchId",
      "chainId",
      "owner",
      "pmon",
      "burnAddress",
      "vrfWrapper",
      "ypal",
      "registry",
      "monsters",
      "engine",
      "implementations",
      "packTypeId",
      "packageSha256",
      "sourceStartBlock",
      "metadataBaseURI",
      "artworkHash",
      "catalogHash",
      "receipts"
    ].sort()
  );
  assert.equal(value.format, "yunipals-ypal-fresh-deployment-confirmed-v1");
  assert.equal(value.chainId, 8453);
  assert.equal(value.launchId, "base-ypal-v1");
  assert.equal(value.packageSha256, PACKAGE_SHA);
  assert(same(value.owner, OWNER));
  for (const key of ["owner", "pmon", "burnAddress", "vrfWrapper"])
    assert(same(value[key], bundle[key]), `fixed ${key}`);
  const deployed = [
    value.ypal,
    value.registry,
    value.monsters,
    value.engine,
    ...Object.values(value.implementations ?? {})
  ];
  assert.equal(deployed.length, 7);
  assert(deployed.every(address));
  assert.equal(new Set(deployed.map((v) => v.toLowerCase())).size, 7);
  assert(
    deployed.every((v) => !OLD.includes(v.toLowerCase())),
    "fresh deployment cannot reuse old stack"
  );
  assert.deepEqual(Object.keys(value.implementations).sort(), [
    "engine",
    "monsters",
    "registry"
  ]);
  assert.equal(value.packTypeId, "1");
  assert.equal(value.artworkHash, bundle.pack.artworkHash);
  assert.equal(value.catalogHash, catalogHash(bundle));
  assert.equal(
    value.metadataBaseURI,
    bundle.tokenMetadataBasePrefix + value.monsters.toLowerCase() + "/"
  );
  assert.deepEqual(Object.keys(value.receipts ?? {}).sort(), [...STEPS].sort());
  let prior = 0n;
  const hashes = new Set();
  for (const [i, step] of STEPS.entries()) {
    const r = value.receipts[step];
    assert.deepEqual(
      Object.keys(r).sort(),
      [
        "transactionHash",
        "blockNumber",
        "blockHash",
        "status",
        "contractAddress"
      ].sort()
    );
    assert.equal(r.status, "success");
    assert(hex32(r.transactionHash));
    assert(hex32(r.blockHash));
    assert(number(r.blockNumber));
    assert(!hashes.has(r.transactionHash.toLowerCase()));
    hashes.add(r.transactionHash.toLowerCase());
    assert(BigInt(r.blockNumber) >= prior);
    prior = BigInt(r.blockNumber);
    const expected =
      i < 7
        ? step.endsWith("Implementation")
          ? value.implementations[step.replace("Implementation", "")]
          : value[step]
        : null;
    assert(
      expected ? same(r.contractAddress, expected) : r.contractAddress === null,
      `actual creation address ${step}`
    );
  }
  const start = ["registry", "monsters", "engine"]
    .map((k) => BigInt(value.receipts[k].blockNumber))
    .reduce((a, b) => (a < b ? a : b));
  assert.equal(value.sourceStartBlock, start.toString());
  return value;
}

export function artwork(bundle, raw) {
  assert.equal(
    sha(raw),
    ARTWORK_MANIFEST_SHA,
    "approved existing artwork manifest required"
  );
  const m = JSON.parse(raw);
  assert.equal(m.slug, "base-mainnet-standard-v1");
  assert.equal(m.catalogHash, catalogHash(bundle));
  assert.equal(m.artworkHash, bundle.pack.artworkHash);
  assert.equal(m.metadataBaseURI, bundle.pack.metadataBaseURI);
  return {
    slug: m.slug,
    sha256: sha(raw),
    artworkHash: m.artworkHash,
    catalogHash: m.catalogHash
  };
}

/** All state reads use one explicit canonical block; no wallet/client writes. */
export async function readConfirmedDeployment(client, unsignedPackage, value) {
  const { bundle: b, packRegistryAbi: abi } = await inputs(
      Buffer.from(json(unsignedPackage))
    ),
    d = manifest(b, value);
  assert.equal(await client.getChainId(), 8453);
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const header = await client.getBlock({ blockNumber });
  assert(hex32(header.hash));
  let priorNonce = -1,
    priorPosition = null;
  const transactions = [];
  for (const [i, step] of STEPS.entries()) {
    const claimed = d.receipts[step];
    const r = await client.getTransactionReceipt({
      hash: claimed.transactionHash
    });
    const tx = await client.getTransaction({ hash: claimed.transactionHash });
    assert.equal(r.status, "success");
    assert.equal(tx.chainId, 8453);
    assert(same(tx.from, OWNER));
    assert(
      same(r.transactionHash, claimed.transactionHash) &&
        same(tx.hash, claimed.transactionHash)
    );
    assert.equal(r.blockNumber, BigInt(claimed.blockNumber));
    assert(r.blockNumber <= blockNumber);
    assert(
      same(r.blockHash, claimed.blockHash) && same(tx.blockHash, r.blockHash)
    );
    assert.equal(tx.blockNumber, r.blockNumber);
    assert(Number.isSafeInteger(r.transactionIndex) && r.transactionIndex >= 0);
    assert.equal(tx.transactionIndex, r.transactionIndex);
    const position = [r.blockNumber, r.transactionIndex];
    assert(
      !priorPosition ||
        position[0] > priorPosition[0] ||
        (position[0] === priorPosition[0] && position[1] > priorPosition[1]),
      "launch order"
    );
    priorPosition = position;
    assert(Number.isSafeInteger(tx.nonce) && tx.nonce > priorNonce);
    priorNonce = tx.nonce;
    const actualHeader = await client.getBlock({ blockNumber: r.blockNumber });
    assert(
      same(actualHeader.hash, r.blockHash),
      "canonical deployment receipt"
    );
    const expected = action(b, abi, d, step);
    assert(same(tx.input, expected.data));
    assert.equal(tx.value, 0n);
    assert(expected.to ? same(tx.to, expected.to) : tx.to === null);
    assert(
      i < 7
        ? same(r.contractAddress, claimed.contractAddress) &&
            same(
              getContractAddress({ from: tx.from, nonce: BigInt(tx.nonce) }),
              r.contractAddress
            )
        : r.contractAddress === null
    );
    if (step === "configure") {
      const events = parseEventLogs({
        abi,
        eventName: "TypeConfigured",
        logs: r.logs,
        strict: true
      }).filter((e) => same(e.address, d.registry));
      assert.equal(events.length, 1);
      assert.equal(events[0].args.packTypeId, 1n);
      assert(same(events[0].args.engine, d.engine));
      assert.equal(events[0].args.catalogHash, d.catalogHash);
    }
    transactions.push({
      step,
      transactionHash: r.transactionHash,
      blockNumber: r.blockNumber.toString(),
      blockHash: r.blockHash,
      contractAddress: r.contractAddress
    });
  }
  const codeHashes = {};
  for (const step of STEPS.slice(0, 7)) {
    const key = step.replace("Implementation", "");
    const deployed = step.endsWith("Implementation")
      ? d.implementations[key]
      : d[step];
    const a =
      b.artifacts[
        step === "ypal"
          ? "ypal"
          : step.endsWith("Implementation")
            ? key
            : "proxy"
      ];
    const code = await client.getCode({ address: deployed, blockNumber });
    assert.equal(
      keccak256(code ?? "0x"),
      keccak256(runtime(a, deployed, b.pmon)),
      `reviewed runtime ${step}`
    );
    codeHashes[step] = keccak256(code);
    if (step.endsWith("Implementation"))
      assert.equal(
        await client.readContract({
          address: deployed,
          abi: adminAbi,
          functionName: "proxiableUUID",
          blockNumber
        }),
        SLOT
      );
  }
  const read = (a, abi, functionName, args = []) =>
    client.readContract({ address: a, abi, functionName, args, blockNumber });
  for (const key of ["registry", "monsters", "engine"]) {
    assert(
      same(
        await client.getStorageAt({ address: d[key], slot: SLOT, blockNumber }),
        padHex(d.implementations[key], { size: 32 })
      ),
      `implementation ${key}`
    );
    for (const role of [
      "0x" + "0".repeat(64),
      ...["CONFIG_ROLE", "PAUSER_ROLE", "UPGRADER_ROLE"].map((v) =>
        keccak256(new TextEncoder().encode(v))
      )
    ])
      assert.equal(
        await read(d[key], adminAbi, "hasRole", [role, b.owner]),
        true,
        `owner role ${key}`
      );
  }
  const token = {};
  for (const name of [
    "pmon",
    "burnAddress",
    "owner",
    "isLocked",
    "name",
    "symbol",
    "decimals",
    "DOMAIN_SEPARATOR"
  ])
    token[name] = await read(d.ypal, tokenAbi, name);
  assert(
    same(token.pmon, b.pmon) &&
      same(token.burnAddress, b.burnAddress) &&
      same(token.owner, b.owner)
  );
  assert.equal(token.isLocked, false);
  assert.equal(token.name, "Yunipals");
  assert.equal(token.symbol, "YPAL");
  assert.equal(token.decimals, 18);
  assert.equal(
    token.DOMAIN_SEPARATOR,
    hashDomain({
      domain: {
        name: "Yunipals",
        version: "1",
        chainId: 8453n,
        verifyingContract: d.ypal
      },
      types: DOMAIN_TYPES
    })
  );
  const nonce = await read(d.ypal, tokenAbi, "nonces", [b.owner]);
  assert(typeof nonce === "bigint" && nonce >= 0n);
  assert(same(await read(d.monsters, adminAbi, "registry"), d.registry));
  assert.equal(
    await read(d.monsters, adminAbi, "tokenMetadataBaseURI"),
    d.metadataBaseURI
  );
  for (const [key, expected] of [
    ["registry", d.registry],
    ["monsters", d.monsters],
    ["wrapper", b.vrfWrapper]
  ])
    assert(same(await read(d.engine, adminAbi, key), expected));
  assert.equal(await read(d.engine, adminAbi, "MAX_OPEN_PACKS"), 10);
  assert.equal(await read(d.engine, adminAbi, "PERMIT_OPEN_VERSION"), 1n);
  assert.equal(await read(d.engine, adminAbi, "requestsPaused"), false);
  assert.equal(
    await read(d.registry, abi, "typeCount"),
    1n,
    "only fresh public type1"
  );
  const p = await read(d.registry, abi, "getPack", [1n]),
    c = await read(d.registry, abi, "getCatalog", [1n]);
  assert.equal(
    encodeFunctionData({
      abi,
      functionName: "configureType",
      args: [0n, p.rules, c]
    }),
    action(b, abi, d, "configure").data
  );
  assert.equal(p.catalogHash, d.catalogHash);
  assert.equal(p.totalVariants, 264);
  assert.equal(p.active, true);
  assert.equal(p.salesPaused, false);
  const ruleParameter = abi.find(
    (v) => v.type === "function" && v.name === "configureType"
  ).inputs[1];
  assert.equal(
    p.ruleHash,
    keccak256(
      encodeAbiParameters(
        [ruleParameter, { type: "bytes32" }],
        [p.rules, p.catalogHash]
      )
    ),
    "activated immutable rule hash"
  );
  const last = await client.getBlock({ blockNumber });
  assert(same(last.hash, header.hash), "qualification anchor changed");
  return {
    format: "yunipals-ypal-backend-chain-qualification-v1",
    packageSha256: PACKAGE_SHA,
    confirmedManifestSha256: sha(json(value)),
    confirmedManifestHashEncoding: "JSON.stringify(manifest,null,2)+newline",
    chainId: 8453,
    blockNumber: blockNumber.toString(),
    blockHash: header.hash,
    transactions,
    codeHashes,
    addresses: {
      ypal: d.ypal,
      registry: d.registry,
      monsters: d.monsters,
      engine: d.engine,
      implementations: d.implementations
    },
    sourceStartBlock: d.sourceStartBlock,
    currentStateQualified: true,
    databaseWrites: 0,
    serviceChanges: 0,
    chainTransactionsSent: 0
  };
}

export async function qualify(client, input, value, artworkRaw) {
  const art = artwork(input.bundle, artworkRaw);
  return {
    ...(await readConfirmedDeployment(client, input.bundle, value)),
    artwork: art
  };
}

export function candidates(input, value, qualification) {
  const { bundle } = input,
    d = manifest(bundle, value);
  assert.equal(qualification.currentStateQualified, true);
  assert.equal(qualification.packageSha256, PACKAGE_SHA);
  assert.equal(qualification.confirmedManifestSha256, sha(json(value)));
  const publicAddressLines = [
    `BOOSTER_REGISTRY=${d.registry.toLowerCase()}`,
    `BOOSTER_ENGINE=${d.engine.toLowerCase()}`,
    `BOOSTER_MONSTERS=${d.monsters.toLowerCase()}`,
    `BOOSTER_WRAPPER=${d.vrfWrapper.toLowerCase()}`,
    `BOOSTER_DEPLOYMENT_BLOCK=${d.sourceStartBlock}`
  ];
  const sourceEnv = [
    ...publicAddressLines,
    "PONDER_BOOSTERS_ONLY=true",
    "PONDER_ISLANDS_ONLY=false",
    `DATABASE_SCHEMA=${SCHEMA}`,
    "UNIFIED_RPC_POLICY_REQUIRED=true",
    "UNIFIED_RPC_FREE_ONLY=true",
    `UNIFIED_RPC_PROFILE_FILE=${OPS}/normal-rpc-profile-v1.json`,
    `UNIFIED_RPC_PROFILE_ID=${PROFILE}`,
    ""
  ];
  const readerEnv = [
    ...publicAddressLines,
    `BOOSTER_DATABASE_SCHEMA=${SCHEMA}`,
    "BOOSTER_ARTWORK_CATALOGS=base-mainnet-standard-v1",
    ""
  ];
  const project = SOURCE_ROOT + "/apps/yunipals-indexer";
  const exec = [
    "/usr/bin/env",
    "-i",
    "/opt/node-v24.18.1/bin/node",
    "--max-old-space-size=1024",
    "--env-file=/var/lib/yunipals-unified-shadow/20261020-008028af-a/launch.env",
    `--env-file=${project}/launch.public.env`,
    `${project}/node_modules/ponder/dist/esm/bin/ponder.js`,
    "start",
    "--root",
    project,
    "--config",
    "ponder.boosters.launch.config.ts",
    "--schema",
    SCHEMA,
    "--hostname",
    "127.0.0.1",
    "--port",
    "9026"
  ];
  const sourceUnit = [
    "[Unit]",
    "Description=Fresh YPAL Base booster source; consolidate after shared acceptance",
    "After=postgresql.service",
    "[Service]",
    "Type=exec",
    "User=yunipals_unified_shadow",
    "Group=yunipals_unified_shadow",
    `WorkingDirectory=${project}`,
    `ExecStart=${exec.join(" ")}`,
    "Restart=on-failure",
    "RestartSec=5",
    "RuntimeMaxSec=infinity",
    "TimeoutStartSec=15",
    "TimeoutStopSec=30",
    "KillMode=control-group",
    "MemoryMax=2147483648",
    "MemorySwapMax=0",
    "CPUQuota=100%",
    "IOWeight=10",
    "TasksMax=128",
    "LimitCORE=0",
    "NoNewPrivileges=yes",
    "PrivateTmp=yes",
    "ProtectSystem=strict",
    "ProtectHome=yes",
    "RestrictSUIDSGID=yes",
    "UMask=0027",
    "IPAddressDeny=any",
    "IPAddressAllow=127.0.0.0/8 ::1",
    `ReadWritePaths=${project}/.ponder ${project}/ponder-env.d.ts ${project}/node_modules/.vite-temp`,
    "[Install]",
    "WantedBy=multi-user.target",
    ""
  ];
  const drop = [
    "[Service]",
    `EnvironmentFile=${PUBLIC_ENV}`,
    "Environment=BOOSTER_ARTWORK_CATALOGS=base-mainnet-standard-v1",
    ""
  ];
  return {
    "source.public.env": sourceEnv.join("\n"),
    "reader.public.env": readerEnv.join("\n"),
    "source.service.candidate": sourceUnit.join("\n"),
    "api-ypal.conf.candidate": drop.join("\n"),
    "queue-ypal.conf.candidate": drop.join("\n")
  };
}

/** Freeze actual newly-created native object IDs, then grant only ten reads. */
export function readerSql(catalog) {
  assert.equal(catalog.schema, SCHEMA);
  assert(Number.isSafeInteger(catalog.schemaOid) && catalog.schemaOid > 0);
  assert(
    Number.isSafeInteger(catalog.sourceOwnerOid) && catalog.sourceOwnerOid > 0
  );
  assert(Number.isSafeInteger(catalog.readerOid) && catalog.readerOid > 0);
  assert.equal(catalog.readerName, "yunipals_unified_collector");
  assert.equal(catalog.sourceOwnerName, "yunipals_unified_shadow");
  assert.deepEqual(catalog.tables.map((t) => t.name).sort(), TABLES);
  assert.equal(new Set(catalog.tables.map((t) => t.oid)).size, 10);
  for (const t of catalog.tables)
    assert(
      Number.isSafeInteger(t.oid) &&
        t.oid > 0 &&
        t.owner === catalog.sourceOwnerOid &&
        t.kind === "r"
    );
  const checks = catalog.tables
    .map(
      (t) =>
        `IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=${t.oid} AND relnamespace=${catalog.schemaOid} AND relname='${t.name}' AND relowner=${catalog.sourceOwnerOid} AND relkind='r') THEN RAISE EXCEPTION 'native table identity changed'; END IF;`
    )
    .join("\n");
  const guard = `DO $guard$ BEGIN\nIF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE oid=${catalog.schemaOid} AND nspname='${SCHEMA}' AND nspowner=${catalog.sourceOwnerOid}) OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=${catalog.sourceOwnerOid} AND rolname='yunipals_unified_shadow') OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=${catalog.readerOid} AND rolname='yunipals_unified_collector') THEN RAISE EXCEPTION 'namespace or reader identity changed'; END IF;\n${checks}\nEND $guard$;\n`;
  const prefix =
    "BEGIN;\nSET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='10s';\n" +
    guard;
  const grants = `GRANT USAGE ON SCHEMA ${SCHEMA} TO yunipals_unified_collector;\nGRANT SELECT ON ${TABLES.map((t) => `${SCHEMA}.${t}`).join(", ")} TO yunipals_unified_collector;\n`;
  // Inverse is authorized only against an exact owned post-grant graph receipt;
  // preserve any preexisting grants instead of synthesizing a destructive undo.
  return {
    rehearsal: prefix + grants + "ROLLBACK;\n",
    apply: prefix + grants + "COMMIT;\n",
    inverseRequiresOwnedGraphReceipt: true
  };
}

async function publicRead(file, limit = 2_000_000) {
  const before = await lstat(file);
  assert(
    before.isFile() && !before.isSymbolicLink() && before.size <= limit,
    "bounded regular public input"
  );
  const raw = await readFile(file),
    after = await lstat(file);
  assert.equal(before.ino, after.ino);
  assert.equal(before.dev, after.dev);
  assert.equal(before.mtimeMs, after.mtimeMs);
  assert.equal(before.ctimeMs, after.ctimeMs);
  return raw;
}
export async function writeCandidates(output, files) {
  // Fresh directory only; no overwrite/resume and no existing system files.
  await mkdir(output, { mode: 0o700 });
  await chmod(output, 0o700);
  for (const [name, body] of Object.entries(files)) {
    assert(/^[a-z0-9.-]+$/.test(name));
    await writeFile(resolve(output, name), body, { flag: "wx", mode: 0o600 });
  }
  return Object.fromEntries(
    Object.entries(files).map(([name, body]) => [
      name,
      { sha256: sha(body), bytes: Buffer.byteLength(body) }
    ])
  );
}

export async function freeClient(fetcher = fetch) {
  const headers = {
    "x-yunipals-unified-rpc-profile": PROFILE,
    "x-yunipals-rpc-workload": "unified_evidence"
  };
  const get = async (path) => {
    const r = await fetcher("http://127.0.0.1:19202" + path, {
      headers,
      signal: AbortSignal.timeout(5000),
      redirect: "error"
    });
    assert(r.ok);
    return r.json();
  };
  const guard = async () => {
    const m = await get("/metrics"),
      p = await get("/unified/preflight");
    assert.equal(m.freeRouting, true);
    assert.equal(m.paidFallbackOnFreeFailure, false);
    assert.equal(m.sourcePaidFallbackOnFreeFailure, false);
    assert.equal(m.unified.profileId, PROFILE);
    assert.equal(m.unified.chainId, 8453);
    assert.equal(m.unified.sourceRouting, "free_first");
    for (const w of ["unified_source", "unified_evidence"])
      assert.equal(m.unified.traffic[w].paidCalls, 0);
    assert.equal(p.profileId, PROFILE);
    assert.equal(p.chainId, 8453);
    assert.equal(p.replay.mode, "free_only");
  };
  await guard();
  return {
    client: createPublicClient({
      transport: http("http://127.0.0.1:19202/unified", {
        retryCount: 0,
        timeout: 8000,
        batch: false,
        fetchFn: fetcher,
        fetchOptions: { headers }
      })
    }),
    guard
  };
}
async function main() {
  const { values } = parseArgs({
    options: {
      package: { type: "string" },
      confirmed: { type: "string" },
      artwork: { type: "string" },
      output: { type: "string" },
      "verify-free-rpc": { type: "boolean", default: false }
    }
  });
  assert(
    values.package && values.confirmed && values.artwork,
    "--package --confirmed --artwork required"
  );
  const input = await inputs(await publicRead(resolve(values.package))),
    raw = await publicRead(resolve(values.confirmed)),
    value = manifest(input.bundle, JSON.parse(raw));
  const art = await publicRead(resolve(values.artwork));
  artwork(input.bundle, art);
  if (!values["verify-free-rpc"]) {
    assert(!values.output, "output requires fresh chain qualification");
    console.log(
      json({
        format: "yunipals-ypal-backend-static-review-v1",
        packageSha256: PACKAGE_SHA,
        confirmedFileSha256: sha(raw),
        staticManifestValid: true,
        chainQualified: false,
        hostQualified: false,
        liveActions: 0
      })
    );
    return;
  }
  const { client, guard } = await freeClient();
  const q = await qualify(client, input, value, art);
  await guard();
  const files = {
    ...candidates(input, value, q),
    "confirmed.json": raw,
    "chain-qualification.json": json(q)
  };
  const out = values.output
    ? await writeCandidates(resolve(values.output), files)
    : null;
  console.log(
    json({
      format: "yunipals-ypal-backend-preparation-v1",
      chain: q,
      files: out,
      hostQualified: false,
      liveActions: 0,
      requiredNext:
        "fresh protected host review, inactive workspace build proof, exact old-source drain, fresh native readiness, actual OID read admission, owned API/queue switch"
    })
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error(
      "YPAL backend preparation refused; no host transition was attempted."
    );
    process.exitCode = 1;
  });
