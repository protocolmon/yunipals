import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, rm, lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inputs,
  manifest,
  action,
  rules,
  runtime,
  catalogHash,
  qualify,
  freeClient,
  readConfirmedDeployment,
  candidates,
  readerSql,
  writeCandidates,
  PACKAGE_SHA,
  SCHEMA,
  SLOT,
  STEPS,
  TABLES,
  PROFILE
} from "./ypal-backend-prepare-v1.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(
  join(root, "apps/yunipals-home-web/package.json")
);
const {
  getContractAddress,
  encodeEventTopics,
  encodeAbiParameters,
  parseAbiParameters,
  padHex,
  keccak256,
  hashDomain
} = require("viem");
const raw = await readFile(
  join(root, "apps/yunipals-home-web/public/boosters/ypal-fresh-launch-v1.json")
);
const input = await inputs(raw);
const artwork = await readFile(
  join(
    root,
    "docs/boosters/ypal-fresh-launch-2026-10-23/backend-approved-artwork-manifest.json"
  )
);
test("actual viem wire request uses /unified and free-only headers, never the root RPC route", async () => {
  const calls = [];
  const fetcher = async (request, init = {}) => {
    const url = new URL(typeof request === "string" ? request : request.url);
    const headers = new Headers(init.headers ?? request.headers);
    assert.equal(url.origin, "http://127.0.0.1:19202");
    assert.equal(headers.get("x-yunipals-unified-rpc-profile"), PROFILE);
    assert.equal(headers.get("x-yunipals-rpc-workload"), "unified_evidence");
    assert.equal(headers.get("x-yunipals-unified-rpc-permit"), null);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, method: init.method ?? "GET", body });
    if (url.pathname === "/metrics")
      return Response.json({
        freeRouting: true,
        paidFallbackOnFreeFailure: false,
        sourcePaidFallbackOnFreeFailure: false,
        unified: {
          profileId: PROFILE,
          chainId: 8453,
          sourceRouting: "free_first",
          traffic: {
            unified_source: { paidCalls: 0 },
            unified_evidence: { paidCalls: 0 }
          }
        }
      });
    if (url.pathname === "/unified/preflight")
      return Response.json({
        profileId: PROFILE,
        chainId: 8453,
        replay: { mode: "free_only" }
      });
    assert.equal(url.pathname, "/unified");
    assert.equal(init.method, "POST");
    assert.equal(body.method, "eth_chainId");
    return Response.json({ jsonrpc: "2.0", id: body.id, result: "0x2105" });
  };
  const { client, guard } = await freeClient(fetcher);
  assert.equal(await client.getChainId(), 8453);
  await guard();
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(calls.filter((c) => c.path === "/").length, 0);
});
const h = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
const TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
  ]
};
function fixture() {
  const { bundle: b, packRegistryAbi: abi } = input;
  const addresses = Object.fromEntries(
    STEPS.slice(0, 7).map((step, i) => [
      step,
      getContractAddress({ from: b.owner, nonce: BigInt(100 + i) })
    ])
  );
  const d = {
    format: "yunipals-ypal-fresh-deployment-confirmed-v1",
    launchId: "base-ypal-v1",
    chainId: 8453,
    owner: b.owner,
    pmon: b.pmon,
    burnAddress: b.burnAddress,
    vrfWrapper: b.vrfWrapper,
    ypal: addresses.ypal,
    registry: addresses.registry,
    monsters: addresses.monsters,
    engine: addresses.engine,
    implementations: {
      registry: addresses.registryImplementation,
      monsters: addresses.monstersImplementation,
      engine: addresses.engineImplementation
    },
    packTypeId: "1",
    packageSha256: PACKAGE_SHA,
    sourceStartBlock: "102",
    metadataBaseURI:
      b.tokenMetadataBasePrefix + addresses.monsters.toLowerCase() + "/",
    artworkHash: b.pack.artworkHash,
    catalogHash: catalogHash(b),
    receipts: {}
  };
  const receipts = new Map(),
    transactions = new Map(),
    codes = new Map(),
    calls = [];
  for (const [i, step] of STEPS.entries()) {
    const a = action(b, abi, d, step),
      hash = h(i + 1),
      blockNumber = BigInt(100 + i),
      blockHash = h(blockNumber);
    const contractAddress = i < 7 ? addresses[step] : null;
    const logs =
      step === "configure"
        ? [
            {
              address: d.registry,
              topics: encodeEventTopics({
                abi,
                eventName: "TypeConfigured",
                args: { packTypeId: 1n, engine: d.engine }
              }),
              data: encodeAbiParameters(parseAbiParameters("bytes32"), [
                d.catalogHash
              ]),
              blockNumber,
              blockHash,
              transactionHash: hash,
              transactionIndex: 0,
              logIndex: 0,
              removed: false
            }
          ]
        : [];
    receipts.set(hash, {
      transactionHash: hash,
      blockNumber,
      blockHash,
      status: "success",
      contractAddress,
      transactionIndex: 0,
      logs
    });
    transactions.set(hash, {
      hash,
      blockNumber,
      blockHash,
      chainId: 8453,
      from: b.owner,
      to: a.to,
      input: a.data,
      value: 0n,
      nonce: 100 + i,
      transactionIndex: 0
    });
    d.receipts[step] = {
      transactionHash: hash,
      blockNumber: blockNumber.toString(),
      blockHash,
      status: "success",
      contractAddress
    };
    if (i < 7) {
      const key = step.replace("Implementation", "");
      const artifact =
        b.artifacts[
          step === "ypal"
            ? "ypal"
            : step.endsWith("Implementation")
              ? key
              : "proxy"
        ];
      codes.set(
        contractAddress.toLowerCase(),
        runtime(artifact, contractAddress, b.pmon)
      );
    }
  }
  const parameter = abi.find(
    (v) => v.type === "function" && v.name === "configureType"
  ).inputs[1];
  const pack = {
    rules: rules(b, d),
    catalogHash: d.catalogHash,
    ruleHash: keccak256(
      encodeAbiParameters(
        [parameter, { type: "bytes32" }],
        [rules(b, d), d.catalogHash]
      )
    ),
    totalVariants: 264,
    openings: 0n,
    active: true,
    salesPaused: false
  };
  const state = {
    chain: 8453,
    blockHash: h(200),
    canonical: true,
    slot: null,
    roles: true,
    pack,
    count: 1n,
    catalog: b.pack.catalog,
    token: {
      pmon: b.pmon,
      burnAddress: b.burnAddress,
      owner: b.owner,
      isLocked: false,
      name: "Yunipals",
      symbol: "YPAL",
      decimals: 18,
      DOMAIN_SEPARATOR: hashDomain({
        domain: {
          name: "Yunipals",
          version: "1",
          chainId: 8453n,
          verifyingContract: d.ypal
        },
        types: TYPES
      }),
      nonces: 0n
    },
    engine: {
      registry: d.registry,
      monsters: d.monsters,
      wrapper: b.vrfWrapper,
      MAX_OPEN_PACKS: 10,
      PERMIT_OPEN_VERSION: 1n,
      requestsPaused: false
    },
    metadata: d.metadataBaseURI
  };
  const client = {
    async getChainId() {
      return state.chain;
    },
    async getBlockNumber() {
      return 200n;
    },
    async getBlock({ blockNumber }) {
      calls.push(["header", blockNumber]);
      return {
        hash:
          blockNumber === 200n
            ? state.blockHash
            : state.canonical
              ? h(blockNumber)
              : h(999)
      };
    },
    async getTransactionReceipt({ hash }) {
      return receipts.get(hash);
    },
    async getTransaction({ hash }) {
      return transactions.get(hash);
    },
    async getCode({ address, blockNumber }) {
      assert.equal(blockNumber, 200n);
      return codes.get(address.toLowerCase());
    },
    async getStorageAt({ address, blockNumber, slot }) {
      assert.equal(slot, SLOT);
      assert.equal(blockNumber, 200n);
      const key = ["registry", "monsters", "engine"].find(
        (k) => d[k] === address
      );
      return state.slot ?? padHex(d.implementations[key], { size: 32 });
    },
    async readContract({ address, functionName, blockNumber }) {
      assert.equal(blockNumber, 200n);
      calls.push([functionName, address]);
      if (functionName === "proxiableUUID") return SLOT;
      if (functionName === "hasRole") return state.roles;
      if (address === d.ypal) return state.token[functionName];
      if (address === d.engine) return state.engine[functionName];
      if (address === d.monsters)
        return functionName === "registry" ? d.registry : state.metadata;
      if (functionName === "typeCount") return state.count;
      if (functionName === "getPack") return state.pack;
      if (functionName === "getCatalog") return state.catalog;
      throw Error("unexpected read");
    }
  };
  return { b, abi, d, client, state, transactions, receipts, codes, calls };
}
const run = (f) => qualify(f.client, input, f.d, artwork);
test("exact public package and approved manifest, never arbitrary self-consistent package", async () => {
  await assert.rejects(
    inputs(Buffer.concat([raw, Buffer.from(" ")])),
    /exact reviewed/
  );
  const f = fixture();
  const q = await run(f);
  assert.equal(q.currentStateQualified, true);
  assert.equal(q.transactions.length, 10);
  assert.equal(q.artwork.slug, "base-mainnet-standard-v1");
  assert.equal(q.databaseWrites, 0);
  assert.equal(q.chainTransactionsSent, 0);
  await assert.rejects(
    qualify(f.client, input, f.d, Buffer.from("{}")),
    /approved existing artwork/
  );
});
test("canonical actual creations and state return reusable verified address/provenance proof", async () => {
  const f = fixture(),
    q = await readConfirmedDeployment(f.client, f.b, f.d);
  assert.deepEqual(q.addresses.implementations, f.d.implementations);
  assert.equal(q.sourceStartBlock, "102");
  assert.equal(Object.keys(q.codeHashes).length, 7);
  assert.equal(q.blockNumber, "200");
  assert.equal(q.blockHash, h(200));
  assert.deepEqual(
    q.transactions.map((t) => t.contractAddress),
    STEPS.map((s) => f.d.receipts[s].contractAddress)
  );
});
test("manifest rejects old stack, missing/fake receipts, wrong starts, unsafe IDs and extra private keys", () => {
  for (const mutate of [
    (d) => (d.engine = "0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609"),
    (d) => delete d.receipts.activate,
    (d) => (d.receipts.metadata.status = "reverted"),
    (d) => (d.receipts.engine.contractAddress = d.registry),
    (d) => (d.sourceStartBlock = "103"),
    (d) => (d.sourceStartBlock = "1e2"),
    (d) => (d.packTypeId = "2"),
    (d) => (d.packageSha256 = "0".repeat(64)),
    (d) =>
      (d.receipts.activate.transactionHash =
        d.receipts.metadata.transactionHash),
    (d) => (d.metadataBaseURI = input.bundle.pack.metadataBaseURI),
    (d) => (d.privateKey = "never accepted")
  ]) {
    const f = fixture();
    mutate(f.d);
    assert.throws(() => manifest(f.b, f.d));
  }
});
test("actual transactions must match calldata/owner/chain/value/receipt hashes and CREATE nonce", async () => {
  for (const mutate of [
    (f) => (f.transactions.get(h(3)).input = "0x"),
    (f) => (f.transactions.get(h(1)).value = 1n),
    (f) => (f.transactions.get(h(7)).from = f.d.registry),
    (f) => (f.transactions.get(h(1)).chainId = 1),
    (f) => (f.transactions.get(h(1)).nonce = 999),
    (f) => (f.transactions.get(h(9)).to = f.d.engine),
    (f) => (f.receipts.get(h(1)).status = "reverted"),
    (f) => (f.transactions.get(h(1)).blockHash = h(999)),
    (f) => (f.receipts.get(h(1)).transactionHash = h(999)),
    (f) => (f.receipts.get(h(1)).transactionIndex = 1),
    (f) => (f.state.canonical = false)
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(run(f));
  }
});
test("runtime immutable patches, implementation slot, roles and engine capabilities are exact", async () => {
  for (const mutate of [
    (f) => f.codes.set(f.d.engine.toLowerCase(), "0x00"),
    (f) =>
      f.codes.set(
        f.d.implementations.engine.toLowerCase(),
        f.b.artifacts.engine.runtimeTemplate
      ),
    (f) => (f.state.slot = h(99)),
    (f) => (f.state.roles = false),
    (f) => (f.state.engine.wrapper = f.d.ypal),
    (f) => (f.state.engine.MAX_OPEN_PACKS = 9),
    (f) => (f.state.engine.PERMIT_OPEN_VERSION = 0n),
    (f) => (f.state.engine.requestsPaused = true),
    (f) => (f.state.metadata = f.b.pack.metadataBaseURI)
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(run(f));
  }
});
test("actual YPAL backing/owner/branding/domain and permit nonce must match", async () => {
  for (const [key, value] of [
    ["pmon", "0x" + "11".repeat(20)],
    ["burnAddress", "0x" + "11".repeat(20)],
    ["owner", "0x" + "11".repeat(20)],
    ["name", "PROTO"],
    ["symbol", "PROTO"],
    ["isLocked", true],
    ["decimals", 6],
    ["DOMAIN_SEPARATOR", h(99)],
    ["nonces", -1n]
  ]) {
    const f = fixture();
    f.state.token[key] = value;
    await assert.rejects(run(f));
  }
});
test("only single unlimited activated type1; immutable rules and canonical anchor cannot drift", async () => {
  for (const mutate of [
    (f) => (f.state.count = 2n),
    (f) => (f.state.pack.active = false),
    (f) => (f.state.pack.salesPaused = true),
    (f) => (f.state.pack.rules.paymentToken = f.d.registry),
    (f) => (f.state.pack.rules.supplyCap = 1n),
    (f) => (f.state.pack.ruleHash = h(999)),
    (f) => (f.state.catalog = { ...f.state.catalog, colors: [1] })
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(run(f));
  }
  const f = fixture();
  let anchors = 0;
  const prior = f.client.getBlock;
  f.client.getBlock = async (p) =>
    p.blockNumber === 200n && ++anchors === 2 ? { hash: h(999) } : prior(p);
  await assert.rejects(run(f), /anchor changed/);
  const sold = fixture();
  sold.state.pack.openings = 10n;
  assert.equal(
    (await run(sold)).currentStateQualified,
    true,
    "legitimate fresh sales don't freeze an empty collection"
  );
});
test("candidate source/reader overlays bind one fresh schema, no old history, same free-only policy and no paid permit", async () => {
  const f = fixture(),
    q = await run(f),
    files = candidates(input, f.d, q);
  for (const name of ["source.public.env", "reader.public.env"]) {
    assert(files[name].includes(f.d.engine.toLowerCase()));
    assert(!files[name].includes("455fabad"));
    assert(!files[name].includes("DATABASE_URL"));
  }
  assert(files["source.public.env"].includes("UNIFIED_RPC_FREE_ONLY=true"));
  assert(files["source.public.env"].includes(PROFILE));
  assert(!files["source.public.env"].includes("REPLAY_PERMIT"));
  assert(files["source.public.env"].includes("DATABASE_SCHEMA=" + SCHEMA));
  assert(
    files["reader.public.env"].includes("BOOSTER_DATABASE_SCHEMA=" + SCHEMA)
  );
  assert(!files["reader.public.env"].includes("smoke"));
  assert(files["source.service.candidate"].includes("RuntimeMaxSec=infinity"));
  assert(!files["source.service.candidate"].includes("716994"));
  const changed = structuredClone(f.d);
  changed.receipts.activate.blockHash = h(998);
  assert.throws(() => candidates(input, changed, q));
});
test("new read SQL requires actual complete ten-table identities; no writes, LOGIN or guessed OIDs", () => {
  const c = {
    schema: SCHEMA,
    schemaOid: 100,
    sourceOwnerOid: 101,
    sourceOwnerName: "yunipals_unified_shadow",
    readerName: "yunipals_unified_collector",
    readerOid: 102,
    tables: TABLES.map((name, i) => ({
      name,
      oid: 200 + i,
      owner: 101,
      kind: "r"
    }))
  };
  const sql = readerSql(c);
  assert(sql.rehearsal.endsWith("ROLLBACK;\n"));
  assert(sql.apply.endsWith("COMMIT;\n"));
  assert(
    !/CREATE|INSERT|UPDATE|DELETE|LOGIN|PASSWORD|ALTER ROLE|DROP|TRUNCATE/.test(
      sql.apply
    )
  );
  assert.equal(sql.inverseRequiresOwnedGraphReceipt, true);
  for (const mutate of [
    (c) => c.tables.pop(),
    (c) => (c.tables[0].oid = 0),
    (c) => (c.tables[0].owner = 999),
    (c) => (c.schema = "unified_shadow_20261020_7e7375b0"),
    (c) => (c.readerName = "postgres")
  ]) {
    const v = structuredClone(c);
    mutate(v);
    assert.throws(() => readerSql(v));
  }
});
test("fresh local candidates preserve exact bytes/modes and cannot overwrite a prior preparation", async () => {
  const base = await mkdtemp(join(tmpdir(), "ypal-backend-test-")),
    out = join(base, "output");
  try {
    const old = process.umask(0o077);
    try {
      await writeCandidates(out, { "reader.public.env": "a=b\n" });
    } finally {
      process.umask(old);
    }
    assert.equal((await lstat(out)).mode & 0o777, 0o700);
    assert.equal(
      (await lstat(join(out, "reader.public.env"))).mode & 0o777,
      0o600
    );
    assert.equal(
      await readFile(join(out, "reader.public.env"), "utf8"),
      "a=b\n"
    );
    await assert.rejects(
      writeCandidates(out, { "reader.public.env": "changed" }),
      /EEXIST/
    );
    assert.equal(
      await readFile(join(out, "reader.public.env"), "utf8"),
      "a=b\n"
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
