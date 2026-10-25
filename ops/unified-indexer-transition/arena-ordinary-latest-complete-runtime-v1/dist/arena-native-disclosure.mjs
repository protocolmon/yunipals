// accepted264a:apps/yunipals-market-api/src/arena/live/nativeDisclosureWorker.ts
import { setTimeout } from "node:timers/promises";
import pg2 from "pg";

// accepted264a:apps/yunipals-market-api/src/arena/live/config.ts
import {
  createPublicClient,
  http,
  isAddress
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, bsc, mainnet, polygon } from "viem/chains";

// accepted264a:packages/yunipals-indexer-server/src/identity.ts
import { createHash } from "node:crypto";

// accepted264a:packages/yunipals-indexer-client/src/sources.ts
function confirmationPolicyKey(policy) {
  switch (policy.kind) {
    case "latest":
    case "finalized":
      return policy.kind;
    case "depth":
      if (!Number.isSafeInteger(policy.subsequentBlocks) || policy.subsequentBlocks < 1) {
        throw new Error("Confirmation depth must be a positive safe integer.");
      }
      return `depth:${policy.subsequentBlocks}`;
    default:
      throw new Error("Unsupported confirmation policy.");
  }
}
var features = [
  "ownership",
  "islands",
  "boosters",
  "base-metadata",
  "marketplace",
  "arena"
];
var chains = /* @__PURE__ */ new Set([1, 56, 137, 8453]);
var decimal = /^(0|[1-9][0-9]*)$/;
function validateSourceManifest(manifest) {
  if (manifest.version !== 1 || manifest.ponderVersion !== "0.17.5" || manifest.ordering !== "multichain" || manifest.coverage !== "ponder-live-blocks-v1") {
    throw new Error("Unsupported source manifest runtime.");
  }
  const ids = /* @__PURE__ */ new Set();
  const subscriptions = /* @__PURE__ */ new Set();
  for (const source of manifest.sources) {
    if (!/^[a-z0-9][a-z0-9:_-]*$/.test(source.id) || ids.has(source.id)) {
      throw new Error("Invalid or duplicate source ID.");
    }
    ids.add(source.id);
    if (!features.includes(source.feature) || !chains.has(source.chainId) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(source.contractName) || typeof source.enabled !== "boolean" || !/^0x[0-9a-f]{64}$/.test(source.abiHash) || !["none", "full"].includes(source.receiptRequirement)) {
      throw new Error(`Invalid source configuration: ${source.id}.`);
    }
    if (source.address !== null && (!/^0x[0-9a-f]{40}$/.test(source.address) || /^0x0{40}$/.test(source.address))) {
      throw new Error(`Invalid source address: ${source.id}.`);
    }
    for (const value of [source.startBlock, source.endBlock]) {
      if (value !== null && (!decimal.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER))) {
        throw new Error(`Invalid source block: ${source.id}.`);
      }
    }
    if (source.enabled && (source.address === null || source.startBlock === null) || source.endBlock !== null && (source.startBlock === null || BigInt(source.endBlock) < BigInt(source.startBlock))) {
      throw new Error(`Incomplete source bounds: ${source.id}.`);
    }
    if (source.receiptStartBlock !== void 0 && (!source.enabled || source.receiptRequirement !== "full" || typeof source.receiptStartBlock !== "string" || !decimal.test(source.receiptStartBlock) || BigInt(source.receiptStartBlock) > BigInt(Number.MAX_SAFE_INTEGER) || source.startBlock === null || BigInt(source.receiptStartBlock) < BigInt(source.startBlock) || source.endBlock !== null && BigInt(source.receiptStartBlock) > BigInt(source.endBlock))) {
      throw new Error(`Invalid source receipt history: ${source.id}.`);
    }
    if (source.events.length === 0 || new Set(source.events).size !== source.events.length || source.events.some((event) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(event)) || source.policies.length === 0) {
      throw new Error(`Invalid source filters: ${source.id}.`);
    }
    const policies = source.policies.map(confirmationPolicyKey);
    if (new Set(policies).size !== policies.length) {
      throw new Error(`Duplicate confirmation policy: ${source.id}.`);
    }
    if (source.enabled) {
      for (const event of source.events) {
        const subscription = JSON.stringify([
          source.chainId,
          source.address,
          event
        ]);
        if (subscriptions.has(subscription)) {
          throw new Error(`Duplicate source subscription: ${source.id}.`);
        }
        subscriptions.add(subscription);
      }
    }
  }
}

// accepted264a:packages/yunipals-indexer-server/src/identity.ts
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === void 0)
    throw new Error("Manifest contains a non-JSON value.");
  return encoded;
}
function manifestDigest(value) {
  return `0x${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}
function sourceManifestHash(manifest) {
  validateSourceManifest(manifest);
  return manifestDigest({
    ...manifest,
    sources: [...manifest.sources].sort((a, b) => a.id.localeCompare(b.id))
  });
}
function transactionEvidenceHash(receipt, block) {
  return manifestDigest({ receipt, block });
}

// accepted264a:apps/yunipals-market-api/src/rpcBudgetProxyRegistry.ts
var rpcBudgetProxyPorts = {
  ethereum: 19101,
  base: 19102,
  polygon: 19103,
  bnb: 19104
};
var productionRpcBudgetProxyPorts = {
  ethereum: 19201,
  base: 19202,
  polygon: 19203,
  bnb: 19204
};
function rpcBudgetProxyUrl(chain, deployment = "staging") {
  const ports = deployment === "production" ? productionRpcBudgetProxyPorts : rpcBudgetProxyPorts;
  return `http://127.0.0.1:${ports[chain]}`;
}

// accepted264a:apps/yunipals-market-api/src/arena/live/transport.ts
import { createTransport } from "viem";
function arenaTransport(reads, broadcasts) {
  return (options) => {
    const reader = reads(options);
    const writer = broadcasts?.(options);
    const route = (async (request) => {
      if (request.method === "eth_sendRawTransaction") {
        if (!writer) throw new Error("Arena broadcast endpoint is disabled.");
        return writer.request(request);
      }
      return reader.request(request);
    });
    return createTransport({
      key: "arena-budgeted",
      name: "Arena budgeted reads and signed broadcasts",
      type: "custom",
      retryCount: 0,
      request: route
    });
  };
}

// accepted264a:apps/yunipals-market-api/src/arena/live/funding.ts
function arenaOpenaiFundingMode(env = process.env) {
  const mode = env.ARENA_OPENAI_FUNDING_MODE ?? "capped";
  if (mode !== "capped" && mode !== "ongoing")
    throw new Error("Invalid Arena OpenAI funding mode.");
  return mode;
}

// accepted264a:apps/yunipals-market-api/src/arena/live/privateFile.ts
import fs, { constants } from "node:fs";
import { basename, dirname, normalize } from "node:path";
var credentialRoot = "/run/credentials";
var encryptionKey = "strategy-encryption.key";
var unitCredentials = {
  "yunipals-arena-api.service": [encryptionKey, "admission.key"],
  "yunipals-arena-capacity.service": [encryptionKey],
  "yunipals-arena-control.service": [encryptionKey, "referee.key"],
  "yunipals-arena-lobby.service": [encryptionKey, "operator.key"],
  "yunipals-arena-media.service": [encryptionKey],
  "yunipals-arena-projector.service": [encryptionKey],
  "yunipals-arena-referee.service": [encryptionKey],
  "yunipals-arena-settlement.service": [encryptionKey, "referee.key"],
  "yunipals-arena-native-api.service": [encryptionKey, "admission.key"],
  "yunipals-arena-native-capacity.service": [encryptionKey],
  "yunipals-arena-native-client.service": [encryptionKey],
  "yunipals-arena-native-disclosure.service": [encryptionKey],
  "yunipals-arena-native-media.service": [encryptionKey],
  "yunipals-arena-native-referee.service": [encryptionKey],
  "yunipals-arena-native-execution@lobby.service": [
    encryptionKey,
    "execution.key"
  ],
  "yunipals-arena-native-execution@operator.service": [
    encryptionKey,
    "execution.key"
  ],
  "yunipals-arena-native-execution@referee.service": [
    encryptionKey,
    "execution.key"
  ]
};
function refuse() {
  throw new Error(
    "Arena secret files require owner-only permissions or trusted systemd credentials."
  );
}
function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
function trustedDirectory(path, exactMode) {
  const stat = fs.lstatSync(path);
  if (!stat.isDirectory() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 18) !== 0 || exactMode !== void 0 && (stat.mode & 4095) !== exactMode)
    refuse();
  return stat;
}
function privateCredentialMount(directory, path) {
  const decode = (value) => value.replace(
    /\\([0-7]{3})/g,
    (_, octal) => String.fromCharCode(parseInt(octal, 8))
  );
  const mounts = fs.readFileSync("/proc/self/mountinfo", "utf8").trim().split("\n").map((line) => ({ line, fields: line.split(" ") })).filter(({ fields }) => {
    const point = decode(fields[4] ?? "");
    return point === directory || path.startsWith(`${point}/`) || point === path;
  }).sort((a, b) => (b.fields[4]?.length ?? 0) - (a.fields[4]?.length ?? 0));
  const mount = mounts[0];
  if (!mount || decode(mount.fields[4] ?? "") !== directory) refuse();
  if (mounts.filter(({ fields }) => decode(fields[4] ?? "") === directory).length !== 1)
    refuse();
  const separator = mount.fields.indexOf("-");
  const options = new Set(mount.fields[5]?.split(","));
  if (!/^[1-9][0-9]*$/.test(mount.fields[0] ?? "") || separator < 6 || mount.fields[separator + 1] !== "tmpfs" || mount.fields.slice(6, separator).some(
    (field) => field !== "unbindable" && !/^(shared|master|propagate_from):[1-9][0-9]*$/.test(field)
  ) || options.has("rw") || ["ro", "nosuid", "nodev", "noexec", "nosymfollow"].some(
    (option) => !options.has(option)
  ))
    refuse();
  return { id: mount.fields[0], line: mount.line };
}
function systemdCredential(path, file) {
  const directory = process.env.CREDENTIALS_DIRECTORY;
  const names = directory && Object.hasOwn(unitCredentials, basename(directory)) ? unitCredentials[basename(directory)] : void 0;
  if (!directory || directory !== `${credentialRoot}/${basename(directory)}` || normalize(path) !== path || dirname(path) !== directory || !names?.includes(basename(path)) || file.uid !== 0 || file.gid !== 0 || (file.mode & 4095) !== 288)
    refuse();
  trustedDirectory("/run");
  trustedDirectory(credentialRoot);
  return {
    directory,
    stat: trustedDirectory(directory, 360),
    mount: privateCredentialMount(directory, path)
  };
}
function readPrivateFile(path) {
  const before = fs.lstatSync(path);
  if (!before.isFile()) refuse();
  const loaded = (before.mode & 63) !== 0 ? systemdCredential(path, before) : void 0;
  const descriptor = fs.openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    if (!sameFile(before, fs.fstatSync(descriptor))) refuse();
    if (loaded) {
      const mountId = fs.readFileSync(`/proc/self/fdinfo/${descriptor}`, "utf8").match(/^mnt_id:\s*([1-9][0-9]*)$/m)?.[1];
      if (mountId !== loaded.mount.id) refuse();
    }
    const value = fs.readFileSync(descriptor, "utf8");
    if (!sameFile(before, fs.fstatSync(descriptor)) || !sameFile(before, fs.lstatSync(path)))
      refuse();
    if (loaded) {
      const after = systemdCredential(path, before);
      if (!sameFile(loaded.stat, after.stat) || loaded.mount.line !== after.mount.line)
        refuse();
    }
    return value.trim();
  } finally {
    fs.closeSync(descriptor);
  }
}

// accepted264a:apps/yunipals-market-api/src/arena/live/config.ts
function required(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing ${key}.`);
  return value;
}
function arenaConfig(env = process.env) {
  const contract = required(env, "ARENA_CONTRACT");
  if (!isAddress(contract) || /^0x0{40}$/i.test(contract))
    throw new Error("Invalid ARENA_CONTRACT.");
  const start = required(env, "ARENA_DEPLOYMENT_BLOCK");
  if (!/^[1-9][0-9]*$/.test(start))
    throw new Error("Invalid arena deployment block.");
  const origin = new URL(env.ARENA_PUBLIC_ORIGIN ?? "https://www.yunipals.com");
  if (origin.protocol !== "https:" || origin.origin !== origin.href.replace(/\/$/, ""))
    throw new Error("Arena origin must be an HTTPS origin.");
  const key = readPrivateFile(required(env, "ARENA_ENCRYPTION_KEY_FILE"));
  if (!/^[0-9a-f]{64}$/i.test(key))
    throw new Error("Arena encryption key must be 32 hexadecimal bytes.");
  const port = Number(env.ARENA_PORT ?? 53911);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid arena API port.");
  const rulesHash = required(env, "ARENA_RULES_HASH");
  if (!/^0x[0-9a-f]{64}$/i.test(rulesHash))
    throw new Error("Invalid arena rules hash.");
  const launchMode = env.ARENA_LAUNCH_MODE ?? "pilot";
  if (!["pilot", "public"].includes(launchMode))
    throw new Error("Invalid Arena launch mode.");
  const pilotWallets = (env.ARENA_PILOT_WALLETS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (pilotWallets.some(
    (value) => !isAddress(value) || /^0x0{40}$/i.test(value)
  ) || pilotWallets.length > 20)
    throw new Error("Invalid pilot wallets.");
  if (env.ARENA_ENTRIES_ENABLED === "true" && launchMode === "pilot" && !pilotWallets.length)
    throw new Error("Controlled paid entry requires explicit pilot wallets.");
  return {
    deployment: {
      id: `8453:${contract.toLowerCase()}`,
      contract,
      startBlock: BigInt(start)
    },
    origin: origin.origin,
    databaseUrl: required(env, "ARENA_DATABASE_URL"),
    encryptionKey: Buffer.from(key, "hex"),
    port,
    rulesHash,
    entriesEnabled: env.ARENA_ENTRIES_ENABLED === "true",
    launchMode,
    openaiFundingMode: arenaOpenaiFundingMode(env),
    pilotWallets,
    indexerUrl: env.ARENA_INDEXER_INTERNAL_URL?.trim() || "https://api.yunipals.com/yunipals-indexer",
    admissionKeyFile: env.ARENA_ADMISSION_KEY_FILE
  };
}
function arenaRpcClients() {
  const broadcastUrl = process.env.ARENA_BROADCAST_RPC_URL;
  if (broadcastUrl && broadcastUrl !== "https://mainnet.base.org")
    throw new Error("Unsupported Arena broadcast endpoint.");
  return new Map(
    [
      [mainnet, "ethereum"],
      [base, "base"],
      [polygon, "polygon"],
      [bsc, "bnb"]
    ].map(([chain, name]) => {
      const c = chain;
      return [
        c.id,
        createPublicClient({
          chain: c,
          transport: arenaTransport(
            http(
              rpcBudgetProxyUrl(
                name,
                "production"
              ),
              { retryCount: 0, timeout: 15e3 }
            ),
            c.id === 8453 && broadcastUrl ? http(broadcastUrl, { retryCount: 0, timeout: 15e3 }) : void 0
          )
        })
      ];
    })
  );
}

// accepted264a:apps/yunipals-market-api/src/arena/live/crypto.ts
import {
  createCipheriv,
  createDecipheriv,
  createHash as createHash2,
  randomBytes
} from "node:crypto";
function digest(value) {
  return createHash2("sha256").update(value).digest("hex");
}
var StrategyCipher = class {
  constructor(key) {
    this.key = key;
    if (key.length !== 32)
      throw new Error("Arena encryption key must contain 32 bytes.");
  }
  seal(context, value) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final()
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64");
  }
  open(context, value) {
    const data = Buffer.from(value, "base64");
    if (data.length < 29) throw new Error("Invalid encrypted strategy.");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      data.subarray(0, 12)
    );
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        cipher.update(data.subarray(28)),
        cipher.final()
      ]).toString("utf8")
    );
  }
};

// accepted264a:apps/yunipals-market-api/src/arena/live/intake.ts
import { randomBytes as randomBytes2, randomUUID } from "node:crypto";

// accepted264a:packages/yunipals-market-core/src/arena.ts
import {
  encodeAbiParameters,
  keccak256,
  stringToHex
} from "viem";
var ARENA_CHAIN_ID = 8453;
var ARENA_STRATEGY_LIMIT = 2400;
var ARENA_RESOLUTION_SECONDS = 86400;
var ARENA_FALLBACK_ATTACKS = [
  "Move within reach and use quick direct strikes whenever recovered. Otherwise recover and face the opponent.",
  "Move within reach and use heavy direct body strikes whenever recovered. Otherwise recover and face the opponent.",
  "Approach the opponent's exposed side and use quick direct strikes, recovering between attacks.",
  "Approach the opponent's exposed side and use heavy direct body strikes, recovering between attacks."
];
function automaticStrategy(contract, tournamentId, seat, rulesHash, word) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3 || tournamentId <= 0n)
    throw new Error("Invalid automatic strategy seat.");
  const common = [
    8453n,
    contract,
    tournamentId,
    seat,
    rulesHash,
    word
  ];
  const attack = Number(
    BigInt(
      keccak256(
        encodeAbiParameters(
          [
            { type: "bytes32" },
            { type: "uint256" },
            { type: "address" },
            { type: "uint256" },
            { type: "uint8" },
            { type: "bytes32" },
            { type: "uint256" }
          ],
          [
            keccak256(stringToHex("yunipals-arena/automatic-attack/v1")),
            ...common
          ]
        )
      )
    ) % 4n
  );
  const commitment = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint8" }
      ],
      [
        keccak256(stringToHex("yunipals-arena/automatic-commitment/v1")),
        ...common,
        attack
      ]
    )
  );
  return {
    seat,
    text: ARENA_FALLBACK_ATTACKS[attack],
    commitment,
    salt: `0x${"0".repeat(64)}`,
    signature: "0x",
    source: "automatic"
  };
}
var ARENA_STRATEGY_TYPES = {
  StrategyApproval: [
    { name: "tournamentId", type: "uint256" },
    { name: "seat", type: "uint8" },
    { name: "commitment", type: "bytes32" }
  ]
};
function arenaDomain(contract) {
  return {
    name: "YunipalsArena",
    version: "1",
    chainId: ARENA_CHAIN_ID,
    verifyingContract: contract
  };
}
function canonicalStrategy(text) {
  const normalized = text.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (!normalized || normalized.length > ARENA_STRATEGY_LIMIT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized))
    throw new Error(
      `Strategy must contain 1\u2013${ARENA_STRATEGY_LIMIT} characters.`
    );
  return normalized;
}
function strategyCommitment(contract, tournamentId, seat, text, salt) {
  if (!/^(0x)[a-fA-F0-9]{64}$/.test(salt) || !Number.isInteger(seat) || seat < 0 || seat > 3 || tournamentId <= 0n)
    throw new Error("Invalid strategy commitment parameters.");
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "bytes32" },
        { type: "bytes32" }
      ],
      [
        keccak256(stringToHex("yunipals-arena/strategy/v1")),
        BigInt(ARENA_CHAIN_ID),
        contract,
        tournamentId,
        seat,
        keccak256(stringToHex(canonicalStrategy(text))),
        salt
      ]
    )
  );
}

// accepted264a:apps/yunipals-market-api/src/db/pool.ts
import pg from "pg";
async function transaction(pool, task) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    const result = await task(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

// accepted264a:apps/yunipals-market-api/src/arena/draw.ts
import { createHash as createHash3 } from "node:crypto";
function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === void 0) throw new Error("Cannot hash undefined input.");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

// accepted264a:apps/yunipals-market-api/src/arena/live/tournamentIdentity.ts
function assertObservation(observed) {
  const t = observed.tournament;
  const expected = manifestDigest({
    deployment: t.deployment,
    tournamentId: t.id,
    openedEventId: t.opened.id,
    openedBlockHash: t.opened.blockHash
  });
  if (expected !== t.incarnation || !/^8453:0x[0-9a-f]{40}$/.test(t.deployment) || !/^(0|[1-9][0-9]*)$/.test(t.id) || BigInt(t.id) >= 2n ** 256n || t.id !== t.state.id || !/^0x[0-9a-f]{64}$/.test(observed.releaseId) || !/^0x[0-9a-f]{64}$/.test(t.opened.blockHash) || !/^0x[0-9a-f]{64}$/.test(t.opened.transactionHash) || !Number.isSafeInteger(t.opened.logIndex) || t.opened.logIndex < 0 || t.opened.id !== `${t.deployment}:${t.opened.transactionHash}:${t.opened.logIndex}`)
    throw new Error("Invalid observed Arena identity.");
}
async function selectedMode(db, deployment, adopting = false) {
  const row = (await db.query(
    "SELECT indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1 FOR SHARE",
    [deployment]
  )).rows[0];
  if (row?.indexer_mode !== "unified" || adopting && !row.halted)
    throw new Error(
      "Arena identity migration requires a fenced native deployment."
    );
}
async function identity(db, t) {
  const row = (await db.query(
    `SELECT deployment,tournament_id::text,incarnation,
    opened_event_id,opened_block_hash,bound_release_id,cipher_context FROM yunipals_arena.tournament_identity
    WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 FOR UPDATE`,
    [t.deployment, t.id, t.incarnation]
  )).rows[0];
  if (!row || row.opened_event_id !== t.opened.id || row.opened_block_hash !== t.opened.blockHash)
    throw new Error("Arena durable identity differs from its observed origin.");
  return row;
}
async function registerTournamentIdentity(db, observed) {
  assertObservation(observed);
  const t = observed.tournament;
  await selectedMode(db, t.deployment);
  if ((await db.query(
    `SELECT 1 FROM yunipals_arena.tournament_identity
    WHERE deployment=$1 AND tournament_id=$2 AND incarnation='legacy'`,
    [t.deployment, t.id]
  )).rowCount)
    throw new Error("Legacy Arena records require explicit origin adoption.");
  await db.query(
    `INSERT INTO yunipals_arena.tournament_identity(deployment,tournament_id,incarnation,
    opened_event_id,opened_block_hash,bound_release_id,bound_at,cipher_context)
    VALUES($1,$2,$3,$4,$5,$6,now(),$7) ON CONFLICT DO NOTHING`,
    [
      t.deployment,
      t.id,
      t.incarnation,
      t.opened.id,
      t.opened.blockHash,
      observed.releaseId,
      `${t.deployment}/${t.id}/${t.incarnation}`
    ]
  );
  return identity(db, t);
}

// accepted264a:apps/yunipals-market-api/src/arena/live/sourceSelection.ts
var sourceLeaseKey = (deployment) => `arena/source-selection/${deployment}`;
async function selectedArenaSource(db, deployment) {
  return (await db.query(
    "SELECT epoch,kind,source_id FROM yunipals_arena.source_selection WHERE deployment=$1",
    [deployment]
  )).rows[0];
}
async function assertArenaSourceBinding(db, deployment, binding) {
  const selected = await selectedArenaSource(db, deployment);
  if (selected ? !binding || selected.epoch !== binding.epoch || selected.kind !== binding.kind || selected.source_id !== binding.sourceId : binding)
    throw new Error(
      "Arena source epoch changed; restart with its selected source."
    );
}

// accepted264a:apps/yunipals-market-api/src/arena/live/intake.ts
var ArenaRequestError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
var ArenaIntake = class {
  constructor(pool, deployment, contract, origin, cipher, verify, nativeSource, sourceSelection) {
    this.pool = pool;
    this.deployment = deployment;
    this.contract = contract;
    this.origin = origin;
    this.cipher = cipher;
    this.verify = verify;
    this.nativeSource = nativeSource;
    this.sourceSelection = sourceSelection;
    if (nativeSource && deployment !== `8453:${contract.toLowerCase()}`)
      throw new Error("Native Arena deployment identity mismatch.");
  }
  get indexerMode() {
    return this.nativeSource ? "unified" : "legacy";
  }
  async assertSourceSelection(db = this.pool) {
    if (db !== this.pool)
      await db.query("SELECT pg_advisory_xact_lock_shared(hashtext($1))", [
        sourceLeaseKey(this.deployment)
      ]);
    const row = (await db.query(
      "SELECT indexer_mode FROM yunipals_arena.deployment WHERE id=$1",
      [this.deployment]
    )).rows[0];
    if (!row || row.indexer_mode !== this.indexerMode)
      throw new ArenaRequestError(503, "Arena source selection is not ready.");
    try {
      await assertArenaSourceBinding(db, this.deployment, this.sourceSelection);
    } catch {
      throw new ArenaRequestError(
        503,
        "Arena source epoch changed. Please try again shortly."
      );
    }
  }
  async ready(db = this.pool) {
    await this.assertSourceSelection(db);
    const row = (await db.query(
      `SELECT NOT halted AND indexer_mode=$2 AND ($2='unified' OR finalized_at > now()-interval '3 minutes') AS ready
      FROM yunipals_arena.deployment WHERE id=$1`,
      [this.deployment, this.indexerMode]
    )).rows[0];
    if (!row?.ready)
      throw new ArenaRequestError(
        503,
        "Tournament synchronization is catching up. Please try again shortly."
      );
    if (this.nativeSource) {
      const observed = await this.nativeSource.read("0");
      if (db !== this.pool)
        await db.query(
          `INSERT INTO yunipals_arena.source_operational_cursor(deployment,indexed_block,source_id)
          VALUES($1,$2,$3) ON CONFLICT(deployment) DO UPDATE SET indexed_block=EXCLUDED.indexed_block,
          source_id=EXCLUDED.source_id,observed_at=now()
          WHERE source_operational_cursor.indexed_block<=EXCLUDED.indexed_block`,
          [this.deployment, observed.indexedThroughBlock, observed.releaseId]
        );
    }
  }
  async challenge(wallet) {
    const id = randomUUID();
    const nonce = randomBytes2(24).toString("hex");
    const expires = new Date(Date.now() + 3e5);
    const message = `${new URL(this.origin).host} wants you to sign in with your Ethereum account:
${wallet}

Sign in to Yunipals Arena. This does not authorize a payment.

URI: ${this.origin}/arena
Version: 1
Chain ID: 8453
Nonce: ${nonce}
Issued At: ${(/* @__PURE__ */ new Date()).toISOString()}
Expiration Time: ${expires.toISOString()}
Request ID: ${id}
Resources:
- urn:yunipals:arena:${this.deployment}`;
    await this.pool.query(
      "INSERT INTO yunipals_arena.challenge(id,deployment,wallet,message,expires_at) VALUES($1,$2,$3,$4,$5)",
      [id, this.deployment, wallet.toLowerCase(), message, expires]
    );
    return { id, message, expiresAt: expires.toISOString() };
  }
  async authenticate(id, signature) {
    const challenge = (await this.pool.query(
      `SELECT wallet,message FROM yunipals_arena.challenge
      WHERE id=$1 AND deployment=$2 AND used_at IS NULL AND expires_at>now()`,
      [id, this.deployment]
    )).rows[0];
    if (!challenge || !await this.verify.message({
      address: challenge.wallet,
      message: challenge.message,
      signature
    }))
      throw new ArenaRequestError(401, "Invalid or expired wallet signature.");
    const token = randomBytes2(32).toString("hex");
    await transaction(this.pool, async (db) => {
      const consumed = await db.query(
        "UPDATE yunipals_arena.challenge SET used_at=now() WHERE id=$1 AND deployment=$2 AND used_at IS NULL AND expires_at>now() RETURNING id",
        [id, this.deployment]
      );
      if (!consumed.rowCount)
        throw new ArenaRequestError(
          401,
          "Wallet challenge already used or expired."
        );
      await db.query(
        "INSERT INTO yunipals_arena.session VALUES($1,$2,$3,now()+interval '24 hours')",
        [digest(token), this.deployment, challenge.wallet]
      );
    });
    return { token, wallet: challenge.wallet };
  }
  async wallet(token) {
    if (!token || !/^[0-9a-f]{64}$/.test(token))
      throw new ArenaRequestError(401, "Sign in with your wallet first.");
    const session = (await this.pool.query(
      "SELECT wallet FROM yunipals_arena.session WHERE token_hash=$1 AND deployment=$2 AND expires_at>now()",
      [digest(token), this.deployment]
    )).rows[0];
    if (!session)
      throw new ArenaRequestError(
        401,
        "Wallet session expired. Please sign in again."
      );
    return session.wallet;
  }
  async tournamentContext(id, db = this.pool, lock = false, expectedIncarnation) {
    await this.assertSourceSelection(db);
    if (this.nativeSource) {
      const observed = await this.nativeSource.read(id), t = observed.tournament;
      if (!t) throw new ArenaRequestError(404, "Tournament not found.");
      if (t.deployment !== this.deployment || t.id !== id || t.state.id !== id || expectedIncarnation && expectedIncarnation !== t.incarnation)
        throw new ArenaRequestError(
          409,
          "The tournament opening changed. Refresh before trying again."
        );
      const observation = { ...observed, tournament: t };
      const stored = lock ? await registerTournamentIdentity(db, observation) : (await db.query(
        "SELECT cipher_context FROM yunipals_arena.tournament_identity WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3",
        [this.deployment, id, t.incarnation]
      )).rows[0];
      return {
        state: t.state,
        incarnation: t.incarnation,
        cipherContext: stored?.cipher_context ?? `${this.deployment}/${id}/${t.incarnation}`,
        observation
      };
    }
    const result = await db.query(
      `SELECT state FROM yunipals_arena.tournament WHERE deployment=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
      [this.deployment, id]
    );
    if (!result.rows[0])
      throw new ArenaRequestError(404, "Tournament not found.");
    return {
      state: result.rows[0].state,
      incarnation: "legacy",
      cipherContext: `${this.deployment}/${id}`,
      observation: null
    };
  }
  async state(id, db = this.pool, lock = false) {
    return (await this.tournamentContext(id, db, lock)).state;
  }
  async balance(wallet) {
    await this.assertSourceSelection();
    if (this.nativeSource) {
      if (!this.nativeSource.credit)
        throw new ArenaRequestError(
          503,
          "Arena balance indexing is not ready."
        );
      return (await this.nativeSource.credit(wallet)).amount;
    }
    return (await this.pool.query(
      "SELECT amount FROM yunipals_arena.credit WHERE deployment=$1 AND wallet=$2",
      [this.deployment, wallet.toLowerCase()]
    )).rows[0]?.amount ?? "0";
  }
  async listIds(wallet) {
    await this.assertSourceSelection();
    if (this.nativeSource) {
      if (!this.nativeSource.list)
        throw new ArenaRequestError(
          503,
          "Arena tournament indexing is not ready."
        );
      return (await this.nativeSource.list(wallet)).ids;
    }
    return (await this.pool.query(
      `SELECT id::text FROM yunipals_arena.tournament WHERE deployment=$1
      ${wallet ? "AND (state->>'islandBeneficiary'=$2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(state->'seats') seat WHERE seat->>'player'=$2))" : ""}
      ORDER BY id DESC LIMIT 30`,
      wallet ? [this.deployment, wallet.toLowerCase()] : [this.deployment]
    )).rows.map((row) => row.id);
  }
  async submit(id, wallet, input) {
    let text;
    let commitment;
    try {
      text = canonicalStrategy(input.text);
      commitment = strategyCommitment(
        this.contract,
        BigInt(id),
        input.seat,
        text,
        input.salt
      );
    } catch {
      throw new ArenaRequestError(
        400,
        "Provide a non-empty strategy within the character limit and a 32-byte salt."
      );
    }
    const prior = await this.tournamentContext(id), state = prior.state;
    if (this.nativeSource && input.incarnation !== void 0 && input.incarnation !== prior.incarnation)
      throw new ArenaRequestError(
        409,
        "The tournament opening changed. Refresh before trying again."
      );
    const seat = state.seats[input.seat];
    if (!seat || seat.player.toLowerCase() !== wallet.toLowerCase())
      throw new ArenaRequestError(403, "This seat belongs to another wallet.");
    const valid = await this.verify.strategy({
      address: wallet,
      domain: arenaDomain(this.contract),
      types: ARENA_STRATEGY_TYPES,
      primaryType: "StrategyApproval",
      message: { tournamentId: BigInt(id), seat: input.seat, commitment },
      signature: input.signature
    });
    if (!valid)
      throw new ArenaRequestError(
        401,
        "The strategy signature does not match its text and seat."
      );
    return transaction(this.pool, async (db) => {
      await this.ready(db);
      const context = await this.tournamentContext(
        id,
        db,
        true,
        prior.incarnation
      ), current = context.state;
      if (current.seats[input.seat]?.player.toLowerCase() !== wallet.toLowerCase())
        throw new ArenaRequestError(409, "The tournament seat changed.");
      const existing = (await db.query(
        "SELECT commitment,wallet FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 AND seat=$3 AND incarnation=$4",
        [this.deployment, id, input.seat, context.incarnation]
      )).rows[0];
      if (existing) {
        if (existing.wallet.toLowerCase() !== wallet.toLowerCase())
          throw new ArenaRequestError(
            409,
            "This seat changed and needs reconciliation."
          );
        if (existing.commitment !== commitment)
          throw new ArenaRequestError(
            409,
            "Your first strategy is locked and cannot be replaced."
          );
        return { seat: input.seat, commitment, locked: true };
      }
      if (this.nativeSource && (await db.query(
        `SELECT 1 FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2
        AND seat=$3 AND incarnation<>$4 AND wallet=$5 AND (signature=$6 OR commitment=$7) LIMIT 1`,
        [
          this.deployment,
          id,
          input.seat,
          context.incarnation,
          wallet.toLowerCase(),
          input.signature,
          commitment
        ]
      )).rowCount)
        throw new ArenaRequestError(
          409,
          "Sign a fresh strategy for this tournament opening."
        );
      if (current.phase !== "strategies" || current.deadline * 1e3 <= Date.now())
        throw new ArenaRequestError(
          409,
          "The strategy submission deadline has passed."
        );
      const ciphertext = this.cipher.seal(
        `${context.cipherContext}/seat/${input.seat}`,
        {
          text,
          salt: input.salt
        }
      );
      await db.query(
        "INSERT INTO yunipals_arena.submission(deployment,tournament_id,seat,wallet,commitment,signature,ciphertext,incarnation) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          this.deployment,
          id,
          input.seat,
          wallet.toLowerCase(),
          commitment,
          input.signature,
          ciphertext,
          context.incarnation
        ]
      );
      return { seat: input.seat, commitment, locked: true };
    });
  }
  async ownStrategy(id, wallet, seat) {
    await this.ready();
    const context = await this.tournamentContext(id);
    if (context.state.seats[seat]?.player.toLowerCase() !== wallet.toLowerCase())
      throw new ArenaRequestError(403, "This seat belongs to another wallet.");
    const row = (await this.pool.query(
      `SELECT * FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2
        AND seat=$3 AND wallet=$4 AND incarnation=$5`,
      [this.deployment, id, seat, wallet.toLowerCase(), context.incarnation]
    )).rows[0];
    if (!row) return { seat, locked: false };
    const value = this.cipher.open(
      `${context.cipherContext}/seat/${seat}`,
      row.ciphertext
    );
    const current = await this.tournamentContext(id);
    if (current.incarnation !== context.incarnation || current.state.seats[seat]?.player.toLowerCase() !== wallet.toLowerCase())
      throw new ArenaRequestError(
        409,
        "The tournament opening changed. Refresh before trying again."
      );
    return {
      seat,
      locked: true,
      commitment: row.commitment,
      text: value.text,
      receivedAt: row.created_at.toISOString()
    };
  }
  // Only a confirmed InputFrozen matching this bundle allows the public view to open it.
  async prepareInput(id, build, expectedIncarnation) {
    return transaction(this.pool, async (db) => {
      await this.ready(db);
      const context = await this.tournamentContext(
        id,
        db,
        true,
        expectedIncarnation
      ), state = context.state;
      if (state.phase !== "strategies" || (state.deadline + ARENA_RESOLUTION_SECONDS) * 1e3 <= Date.now())
        throw new ArenaRequestError(409, "Tournament is not ready to freeze.");
      const rows = (await db.query(
        "SELECT * FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 ORDER BY seat",
        [this.deployment, id, context.incarnation]
      )).rows;
      if (state.seats.length !== 4)
        throw new ArenaRequestError(
          409,
          "The roster and island must be ready."
        );
      const strategies = state.seats.map((seat) => {
        const row = rows.find((r) => r.seat === seat.seat);
        if (row && row.wallet.toLowerCase() !== seat.player.toLowerCase())
          throw new ArenaRequestError(
            409,
            "The roster changed and needs reconciliation."
          );
        if (row)
          return {
            seat: row.seat,
            commitment: row.commitment,
            signature: row.signature,
            ...this.cipher.open(
              `${context.cipherContext}/seat/${row.seat}`,
              row.ciphertext
            ),
            source: "player"
          };
        if (Date.now() < state.deadline * 1e3)
          throw new ArenaRequestError(409, "Waiting for all four strategies.");
        if (state.randomWord === null)
          throw new ArenaRequestError(409, "The island draw is not ready.");
        return automaticStrategy(
          this.contract,
          BigInt(id),
          seat.seat,
          state.rulesHash,
          BigInt(state.randomWord)
        );
      });
      const automaticStrategyMask = strategies.reduce(
        (mask, strategy) => mask | (strategy.source === "automatic" ? 1 << strategy.seat : 0),
        0
      );
      const input = build(state, strategies);
      const inputHash = `0x${digest(canonicalJson(input))}`;
      await db.query(
        "INSERT INTO yunipals_arena.frozen_input(deployment,tournament_id,input_hash,ciphertext,incarnation) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [
          this.deployment,
          id,
          inputHash,
          this.cipher.seal(`${context.cipherContext}/input`, {
            input,
            strategies
          }),
          context.incarnation
        ]
      );
      const saved = (await db.query(
        "SELECT input_hash FROM yunipals_arena.frozen_input WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3",
        [this.deployment, id, context.incarnation]
      )).rows[0];
      if (saved.input_hash !== inputHash)
        throw new ArenaRequestError(
          409,
          "Prepared tournament input is immutable."
        );
      return {
        inputHash,
        commitments: strategies.map((s) => s.commitment),
        signatures: strategies.map((s) => s.signature),
        automaticStrategyMask,
        ...this.nativeSource ? { incarnation: context.incarnation } : {}
      };
    });
  }
  /** Private InputFrozen handling is application work. The native reader
   * supplies public evidence; the caller supplies bounded canonical RPC checks.
   */
  async reconcileInputFrozen(id, verifyAction) {
    if (!this.nativeSource)
      throw new Error("Native Arena disclosure requires its selected source.");
    await this.ready();
    const initial = await this.tournamentContext(id), observed = initial.observation;
    const freeze = observed.tournament.inputFrozen;
    if (!freeze || !["resolving", "settled"].includes(initial.state.phase) || !initial.state.inputHash)
      return false;
    if ((await this.pool.query(
      `SELECT 1 FROM yunipals_arena.frozen_input WHERE deployment=$1 AND tournament_id=$2
      AND incarnation=$3 AND input_hash=$4 AND revealed_at IS NOT NULL AND revealed_event_id=$5 AND revealed_block_hash=$6`,
      [
        this.deployment,
        id,
        initial.incarnation,
        initial.state.inputHash,
        freeze.id,
        freeze.blockHash
      ]
    )).rowCount)
      return true;
    await verifyAction(observed);
    return transaction(this.pool, async (db) => {
      await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await this.ready(db);
      const current = await this.tournamentContext(
        id,
        db,
        true,
        initial.incarnation
      ), state = current.state;
      const proof = current.observation.tournament.inputFrozen;
      if (!proof || proof.id !== freeze.id || proof.blockHash !== freeze.blockHash || state.inputHash !== initial.state.inputHash || !["resolving", "settled"].includes(state.phase) || canonicalJson(state.seats) !== canonicalJson(initial.state.seats) || canonicalJson(state.commitments) !== canonicalJson(initial.state.commitments))
        throw new ArenaRequestError(
          409,
          "The canonical frozen input changed during verification."
        );
      const saved = (await db.query(
        `SELECT ciphertext FROM yunipals_arena.frozen_input
        WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND input_hash=$4 FOR UPDATE`,
        [this.deployment, id, current.incarnation, state.inputHash]
      )).rows[0];
      if (!saved || state.seats.length !== 4 || !state.commitments)
        return false;
      const submissions = (await db.query(
        "SELECT * FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3",
        [this.deployment, id, current.incarnation]
      )).rows;
      const mask = state.automaticStrategyMask ?? 0;
      const matches = state.seats.every((seat) => {
        const row = submissions.find((row2) => row2.seat === seat.seat);
        if (!(mask & 1 << seat.seat))
          return row?.wallet.toLowerCase() === seat.player.toLowerCase() && row?.commitment === state.commitments[seat.seat];
        return !row && state.randomWord !== null && automaticStrategy(
          this.contract,
          BigInt(id),
          seat.seat,
          state.rulesHash,
          BigInt(state.randomWord)
        ).commitment === state.commitments[seat.seat];
      });
      if (!matches) return false;
      const bundle = this.cipher.open(`${current.cipherContext}/input`, saved.ciphertext);
      if (`0x${digest(canonicalJson(bundle.input))}` !== state.inputHash || !Array.isArray(bundle.strategies) || bundle.strategies.length !== 4 || !bundle.strategies.every((strategy, seat) => {
        if (strategy.seat !== seat || strategy.commitment !== state.commitments[seat])
          return false;
        if (mask & 1 << seat) {
          if (state.randomWord === null) return false;
          const automatic = automaticStrategy(
            this.contract,
            BigInt(id),
            seat,
            state.rulesHash,
            BigInt(state.randomWord)
          );
          return strategy.source === "automatic" && strategy.text === automatic.text && strategy.salt === automatic.salt && strategy.signature === automatic.signature;
        }
        return strategy.source !== "automatic" && strategyCommitment(
          this.contract,
          BigInt(id),
          seat,
          strategy.text,
          strategy.salt
        ) === strategy.commitment;
      }))
        throw new Error("Prepared Arena input and commitments disagree.");
      await db.query(
        `UPDATE yunipals_arena.frozen_input SET revealed_at=COALESCE(revealed_at,now()),revealed_event_id=$5,revealed_block_hash=$6
        WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND input_hash=$4`,
        [
          this.deployment,
          id,
          current.incarnation,
          state.inputHash,
          proof.id,
          proof.blockHash
        ]
      );
      return true;
    });
  }
  async publicView(id) {
    const view = await transaction(this.pool, async (db) => {
      await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const context = await this.tournamentContext(id, db), state = context.state;
      const seats = await db.query(
        "SELECT seat,wallet FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 ORDER BY seat",
        [this.deployment, id, context.incarnation]
      );
      const frozen = (await db.query(
        `SELECT ciphertext FROM yunipals_arena.frozen_input WHERE deployment=$1 AND tournament_id=$2 AND revealed_at IS NOT NULL AND input_hash=$3
            AND incarnation=$4 ${this.nativeSource ? "AND revealed_event_id=$5 AND revealed_block_hash=$6" : ""}`,
        [
          this.deployment,
          id,
          state.inputHash,
          context.incarnation,
          ...this.nativeSource ? [
            context.observation?.tournament.inputFrozen?.id ?? null,
            context.observation?.tournament.inputFrozen?.blockHash ?? null
          ] : []
        ]
      )).rows[0];
      const strategies = frozen ? this.cipher.open(`${context.cipherContext}/input`, frozen.ciphertext).strategies : null;
      return {
        ...state,
        submittedSeats: seats.rows.filter(
          (s) => state.seats[s.seat]?.player.toLowerCase() === s.wallet.toLowerCase()
        ).map((s) => s.seat),
        strategies,
        ...this.nativeSource ? { incarnation: context.incarnation } : {}
      };
    });
    await this.assertSourceSelection();
    return view;
  }
};

// accepted264a:packages/yunipals-indexer-server/src/database.ts
function sqlIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value) || Buffer.byteLength(value) > 63)
    throw new Error("Invalid shared indexer SQL identifier.");
  return `"${value}"`;
}
async function indexerTransaction(pool, task, readOnly = false) {
  const db = await pool.connect();
  try {
    await db.query(
      readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN ISOLATION LEVEL REPEATABLE READ"
    );
    const result = await task(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

// accepted264a:packages/yunipals-indexer-client/src/events.ts
function validateCanonicalCursor(cursor) {
  const decimal5 = /^(0|[1-9][0-9]*)$/;
  const hash4 = /^0x[0-9a-f]{64}$/;
  const block = (value) => decimal5.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER);
  if (cursor.version !== 1 || !hash4.test(cursor.releaseId) || !cursor.sourceId || !cursor.policy)
    throw new Error("Invalid canonical cursor identity.");
  for (const anchor of [cursor.completed, cursor.target]) {
    if (anchor && (!block(anchor.number) || !hash4.test(anchor.hash)))
      throw new Error("Invalid canonical cursor anchor.");
  }
  if (cursor.target && cursor.completed && BigInt(cursor.target.number) <= BigInt(cursor.completed.number))
    throw new Error("Invalid canonical cursor range.");
  if (cursor.after && (!cursor.target || !block(cursor.after.blockNumber) || !hash4.test(cursor.after.blockHash) || !cursor.after.id || !Number.isSafeInteger(cursor.after.transactionIndex) || cursor.after.transactionIndex < 0 || !Number.isSafeInteger(cursor.after.logIndex) || cursor.after.logIndex < 0 || BigInt(cursor.after.blockNumber) > BigInt(cursor.target.number) || cursor.completed && BigInt(cursor.after.blockNumber) <= BigInt(cursor.completed.number)))
    throw new Error("Invalid canonical cursor position.");
}

// accepted264a:packages/yunipals-indexer-client/src/readiness.ts
function evaluateSourceReadiness(source, snapshot, options) {
  if (!Number.isFinite(options.nowMs) || !Number.isFinite(options.maxObservationAgeMs) || options.maxObservationAgeMs <= 0 || options.requiredThroughBlock !== void 0 && options.requiredThroughBlock < 0n) {
    throw new Error("Invalid readiness evaluation options.");
  }
  const result = (reason, availableThroughBlock = null, requiredThroughBlock = null) => ({
    ready: reason === "ready",
    reason,
    availableThroughBlock,
    requiredThroughBlock
  });
  if (!source.enabled) return result("disabled");
  const policyKey = confirmationPolicyKey(options.policy);
  if (!source.policies.some(
    (policy) => confirmationPolicyKey(policy) === policyKey
  )) {
    return result("policy_unsupported");
  }
  if (snapshot.release.schema !== options.expectedRelease.schema || snapshot.release.buildId !== options.expectedRelease.buildId || snapshot.release.manifestHash !== options.expectedRelease.manifestHash)
    return result("release_mismatch");
  if (source.id !== snapshot.sourceId || source.chainId !== snapshot.chainId) {
    return result("source_mismatch");
  }
  if (snapshot.halted) return result("halted");
  if (source.startBlock === null || snapshot.coverageStartBlock > BigInt(source.startBlock))
    return result("history_missing");
  const fresh = (at) => Number.isFinite(at) && at <= options.nowMs && options.nowMs - at <= options.maxObservationAgeMs;
  const valid = (observation) => observation.chainId === source.chainId && observation.blockNumber >= 0n && /^0x[0-9a-f]{64}$/.test(observation.blockHash);
  if (!fresh(snapshot.indexerObservedAtMs) || !snapshot.head || !fresh(snapshot.head.observedAtMs)) {
    return result("observation_stale");
  }
  if (!valid(snapshot.head)) return result("observation_inconsistent");
  let boundary = snapshot.head.blockNumber;
  if (options.policy.kind === "depth") {
    boundary -= BigInt(options.policy.subsequentBlocks);
  } else if (options.policy.kind === "finalized") {
    if (!snapshot.finalized) return result("finality_unavailable");
    if (!fresh(snapshot.finalized.observedAtMs))
      return result("observation_stale");
    if (!valid(snapshot.finalized) || snapshot.finalized.blockNumber > snapshot.head.blockNumber || snapshot.finalized.blockNumber === snapshot.head.blockNumber && snapshot.finalized.blockHash !== snapshot.head.blockHash)
      return result("observation_inconsistent");
    boundary = snapshot.finalized.blockNumber;
  }
  if (source.endBlock !== null && boundary > BigInt(source.endBlock)) {
    boundary = BigInt(source.endBlock);
  }
  const indexed = snapshot.completeThroughBlock;
  const latestComplete = options.policy.kind === "latest" && options.requiredThroughBlock === void 0;
  const required2 = options.requiredThroughBlock ?? (latestComplete && indexed !== null && indexed < boundary ? indexed : boundary);
  if (indexed === null || indexed < BigInt(source.startBlock)) {
    return result("not_indexed", null, required2);
  }
  if (indexed > snapshot.head.blockNumber) {
    return result("observation_inconsistent", null, required2);
  }
  const available2 = indexed < boundary ? indexed : boundary;
  return result(
    available2 >= required2 && required2 >= BigInt(source.startBlock) && (!latestComplete || snapshot.frameworkReady) ? "ready" : "catching_up",
    available2 < BigInt(source.startBlock) ? null : available2,
    required2
  );
}

// accepted264a:packages/yunipals-indexer-server/src/chain-status.ts
async function readChainStatus(db, releaseId, chainId) {
  return (await db.query(
    `SELECT revision::text,head_number::text,head_hash,head_timestamp::text,
    finalized_number::text,finalized_hash,witness_number::text,witness_hash,
    observed_at_ms::text,provider_id,anchors,halted,error_code,finality_error_code
    FROM yunipals_indexer_control.chain_status WHERE release_id=$1 AND chain_id=$2`,
    [releaseId, chainId]
  )).rows[0] ?? null;
}

// accepted264a:packages/yunipals-indexer-client/src/ponder.ts
function decodePonderCheckpoint(value) {
  if (!/^[0-9]{75}$/.test(value)) {
    throw new Error("Unsupported Ponder checkpoint encoding.");
  }
  return {
    blockTimestamp: BigInt(value.slice(0, 10)),
    chainId: BigInt(value.slice(10, 26)),
    blockNumber: BigInt(value.slice(26, 42)),
    transactionIndex: BigInt(value.slice(42, 58)),
    eventType: Number(value.slice(58, 59)),
    eventIndex: BigInt(value.slice(59, 75))
  };
}
function completePonderBlock(value, chainId) {
  const checkpoint = decodePonderCheckpoint(value);
  if (/^0{75}$/.test(value)) return null;
  if (checkpoint.chainId !== BigInt(chainId)) {
    throw new Error("Ponder checkpoint chain mismatch.");
  }
  const isBlockEnd = checkpoint.transactionIndex === 9999999999999999n && checkpoint.eventType === 9 && checkpoint.eventIndex === 9999999999999999n;
  const block = checkpoint.blockNumber - (isBlockEnd ? 0n : 1n);
  return block < 0n ? null : block;
}
function ponderChainCoverage(row) {
  if (!/^[1-9][0-9]*$/.test(row.chain_id)) {
    throw new Error("Invalid Ponder checkpoint chain ID.");
  }
  const chainId = Number(row.chain_id);
  if (!Number.isSafeInteger(chainId)) {
    throw new Error("Invalid Ponder checkpoint chain ID.");
  }
  return {
    chainId,
    chainName: row.chain_name,
    completeThroughBlock: completePonderBlock(row.latest_checkpoint, chainId),
    // These are Ponder recovery boundaries, never RPC/consensus finality.
    recoveryThroughBlock: completePonderBlock(row.safe_checkpoint, chainId),
    frameworkFinalizedThroughBlock: completePonderBlock(
      row.finalized_checkpoint,
      chainId
    )
  };
}

// accepted264a:packages/yunipals-indexer-server/src/ponder-reader.ts
async function readPonderRuntime(db, schemaName) {
  const schema = sqlIdentifier(schemaName);
  const { rows } = await db.query(`
    SELECT value AS app, COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'chain_id', chain_id::text, 'chain_name', chain_name,
        'latest_checkpoint', latest_checkpoint,
        'safe_checkpoint', safe_checkpoint,
        'finalized_checkpoint', finalized_checkpoint
      ) ORDER BY chain_id) FROM ${schema}._ponder_checkpoint
    ), '[]'::jsonb) AS checkpoints, COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'chain_id', chain_id, 'block_number', block_number::text,
        'block_hash', block_hash, 'parent_hash', parent_hash, 'timestamp', timestamp::text
      ) ORDER BY chain_id) FROM ${schema}.chain_checkpoint
    ), '[]'::jsonb) AS witnesses
    FROM ${schema}._ponder_meta WHERE key='app'
  `);
  const row = rows[0];
  if (!row || row.app.version !== "6" || !row.app.build_id || !Number.isSafeInteger(row.app.heartbeat_at) || row.app.heartbeat_at < 0 || ![0, 1].includes(row.app.is_locked) || ![0, 1].includes(row.app.is_ready) || row.app.is_dev !== 0) {
    throw new Error(
      "Unsupported or missing production Ponder runtime metadata."
    );
  }
  const chains2 = row.checkpoints.map(ponderChainCoverage);
  if (new Set(chains2.map((chain) => chain.chainId)).size !== chains2.length) {
    throw new Error("Conflicting Ponder chain checkpoints.");
  }
  const witnesses = row.witnesses.map((witness) => {
    if (!Number.isSafeInteger(witness.chain_id) || !/^(0|[1-9][0-9]*)$/.test(witness.block_number) || !/^(0|[1-9][0-9]*)$/.test(witness.timestamp) || !/^0x[0-9a-f]{64}$/.test(witness.block_hash) || !/^0x[0-9a-f]{64}$/.test(witness.parent_hash)) {
      throw new Error("Invalid Ponder block witness.");
    }
    return {
      chainId: witness.chain_id,
      blockNumber: BigInt(witness.block_number),
      blockHash: witness.block_hash,
      parentHash: witness.parent_hash,
      timestamp: BigInt(witness.timestamp)
    };
  });
  if (new Set(witnesses.map((witness) => witness.chainId)).size !== witnesses.length || witnesses.some(
    (witness) => !chains2.some((chain) => chain.chainId === witness.chainId)
  )) {
    throw new Error("Conflicting Ponder block witnesses.");
  }
  return {
    schema: schemaName,
    buildId: row.app.build_id,
    observedAtMs: row.app.heartbeat_at,
    running: row.app.is_locked === 1,
    frameworkReady: row.app.is_ready === 1,
    chains: chains2,
    witnesses
  };
}

// accepted264a:packages/yunipals-indexer-server/src/releases.ts
async function readBoundRuntime(db, release) {
  validateSourceManifest(release.manifest);
  if (sourceManifestHash(release.manifest) !== release.manifestHash)
    throw new Error("Release manifest hash mismatch.");
  const runtime = await readPonderRuntime(db, release.schema);
  if (runtime.buildId !== release.buildId)
    throw new Error(
      "Ponder build changed; a new candidate release is required."
    );
  const { rows } = await db.query(
    `SELECT id,chain_id,manifest_hash,definition FROM ${sqlIdentifier(release.schema)}.indexer_source ORDER BY id`
  );
  if (rows.length !== release.manifest.sources.length)
    throw new Error("Ponder source setup is incomplete.");
  for (const row of rows) {
    const expected = release.manifest.sources.find(
      (source) => source.id === row.id
    );
    if (!expected || row.chain_id !== expected.chainId || row.manifest_hash !== release.manifestHash || manifestDigest(JSON.parse(row.definition)) !== manifestDigest(expected)) {
      throw new Error(
        "Ponder source definition does not match the registered release."
      );
    }
  }
  return runtime;
}
async function loadIndexerRelease(db, id) {
  const { rows } = await db.query(
    id ? "SELECT * FROM yunipals_indexer_control.release WHERE id=$1" : `SELECT r.* FROM yunipals_indexer_control.active_release a
      JOIN yunipals_indexer_control.release r ON r.id=a.release_id WHERE a.name='main'`,
    id ? [id] : []
  );
  const row = rows[0];
  if (!row) throw new Error("No selected shared indexer release.");
  const release = {
    id: row.id,
    schema: row.physical_schema,
    buildId: row.build_id,
    manifestHash: row.manifest_hash,
    manifest: row.manifest
  };
  validateSourceManifest(release.manifest);
  if (release.manifestHash !== sourceManifestHash(release.manifest) || release.id !== manifestDigest({
    schema: release.schema,
    buildId: release.buildId,
    manifestHash: release.manifestHash
  }))
    throw new Error("Stored indexer release identity is invalid.");
  return release;
}

// accepted264a:packages/yunipals-indexer-server/src/status.ts
async function readIndexerSourceStatus(db, release, sourceId, policy, options = {}) {
  const source = release.manifest.sources.find(
    (source2) => source2.id === sourceId
  );
  if (!source) throw new Error("Unknown shared indexer source.");
  const runtime = await readBoundRuntime(db, release);
  const status = await readChainStatus(db, release.id, source.chainId);
  const indexed = runtime.chains.find((chain) => chain.chainId === source.chainId)?.completeThroughBlock ?? null;
  const observationTime = Number(status?.observed_at_ms ?? "0");
  const numbers = Object.values(status?.anchors ?? {}).map((anchor2) => {
    if (!/^(0|[1-9][0-9]*)$/.test(anchor2.number) || !/^0x[0-9a-f]{64}$/.test(anchor2.hash))
      throw new Error("Invalid retained chain anchor.");
    return BigInt(anchor2.number);
  });
  const verified = numbers.length ? numbers.reduce((a, b) => a > b ? a : b) : null;
  let branchMatches = false;
  if (status?.witness_number !== null && status?.witness_number !== void 0 && status.witness_hash) {
    branchMatches = (await db.query(
      `SELECT 1 FROM ${sqlIdentifier(release.schema)}.chain_block
      WHERE chain_id=$1 AND block_number=$2::bigint AND block_hash=$3`,
      [source.chainId, status.witness_number, status.witness_hash]
    )).rowCount === 1;
  }
  const observationValid = status !== null && status.error_code === null && branchMatches;
  const snapshot = {
    sourceId,
    chainId: source.chainId,
    release,
    coverageStartBlock: BigInt(source.startBlock ?? "0"),
    frameworkReady: runtime.frameworkReady,
    completeThroughBlock: indexed === null || verified === null ? null : indexed < verified ? indexed : verified,
    indexerObservedAtMs: runtime.observedAtMs,
    halted: status?.halted === true || !runtime.running,
    head: observationValid && status.head_number !== null && status.head_hash ? {
      chainId: source.chainId,
      blockNumber: BigInt(status.head_number),
      blockHash: status.head_hash,
      observedAtMs: observationTime
    } : null,
    finalized: observationValid && status.finality_error_code === null && status.finalized_number !== null && status.finalized_hash ? {
      chainId: source.chainId,
      blockNumber: BigInt(status.finalized_number),
      blockHash: status.finalized_hash,
      observedAtMs: observationTime
    } : null
  };
  let readiness = evaluateSourceReadiness(source, snapshot, {
    expectedRelease: release,
    policy,
    nowMs: options.nowMs ?? Date.now(),
    maxObservationAgeMs: options.maxObservationAgeMs ?? 18e4,
    requiredThroughBlock: options.requiredThroughBlock
  });
  const anchor = readiness.availableThroughBlock === null ? null : status?.anchors[String(readiness.availableThroughBlock)] ?? null;
  const anchorMissing = readiness.availableThroughBlock !== null && (!anchor || anchor.number !== String(readiness.availableThroughBlock) || !/^(0|[1-9][0-9]*)$/.test(anchor.timestamp));
  if (anchorMissing) {
    readiness = {
      ...readiness,
      ready: false,
      reason: "observation_inconsistent",
      availableThroughBlock: null
    };
  }
  return {
    source,
    snapshot,
    readiness,
    anchor: anchorMissing ? null : anchor,
    observationRevision: status?.revision ?? null,
    errorCode: status?.error_code ?? (!branchMatches ? "indexer_witness_unverified" : anchorMissing ? "indexer_anchor_unverified" : null)
  };
}
async function indexerSourceStatus(pool, release, sourceId, policy, options = {}) {
  return indexerTransaction(
    pool,
    (db) => readIndexerSourceStatus(db, release, sourceId, policy, options),
    true
  );
}

// accepted264a:packages/yunipals-indexer-server/src/event-topics.ts
function parseIndexedEventTopics(raw) {
  const value = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 4)
    throw new Error("Invalid indexed event topics.");
  const topics = [];
  let padding = false;
  for (const topic of value) {
    if (topic === null) {
      padding = true;
      continue;
    }
    if (padding || typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic))
      throw new Error("Invalid indexed event topics.");
    topics.push(topic.toLowerCase());
  }
  return topics;
}

// accepted264a:packages/yunipals-indexer-server/src/paging.ts
var CanonicalCursorInvalidated = class extends Error {
};
var CanonicalSourceUnavailable = class extends Error {
};
var receiptKey = (hash4, transaction2) => `${hash4}:${transaction2}`;
async function retainedAnchor(db, release, chainId, anchor) {
  const direct = await db.query(
    `SELECT block_hash FROM ${sqlIdentifier(release.schema)}.chain_block
    WHERE chain_id=$1 AND block_number=$2::bigint`,
    [chainId, anchor.number]
  );
  if (direct.rows[0])
    return direct.rows[0].block_hash === anchor.hash ? "valid" : "changed";
  const retained = await db.query(
    `
    SELECT a.block_hash,a.witness_hash,b.block_hash AS canonical_witness
    FROM yunipals_indexer_control.chain_anchor a LEFT JOIN ${sqlIdentifier(release.schema)}.chain_block b
      ON b.chain_id=a.chain_id AND b.block_number=a.witness_number
    WHERE a.release_id=$1 AND a.chain_id=$2 AND a.block_number=$3::bigint`,
    [release.id, chainId, anchor.number]
  );
  const row = retained.rows[0];
  if (!row || row.canonical_witness !== row.witness_hash) return "expired";
  return row.block_hash === anchor.hash ? "valid" : "changed";
}
async function readCanonicalPage(pool, release, sourceId, policy, options = {}) {
  const pageLimit = options.limit ?? 250;
  if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 1e3)
    throw new Error("Invalid canonical page size.");
  const policyKey = confirmationPolicyKey(policy);
  const source = release.manifest.sources.find(
    (source2) => source2.id === sourceId
  );
  if (!source?.enabled || source.startBlock === null)
    throw new CanonicalSourceUnavailable("Source is disabled or unknown.");
  const cursor = options.cursor ?? {
    version: 1,
    releaseId: release.id,
    sourceId,
    policy: policyKey,
    completed: null,
    target: null,
    after: null
  };
  validateCanonicalCursor(cursor);
  if (cursor.releaseId !== release.id || cursor.sourceId !== sourceId || cursor.policy !== policyKey)
    throw new CanonicalCursorInvalidated(
      "Cursor belongs to another release, source or policy."
    );
  const from = cursor.completed ? BigInt(cursor.completed.number) + 1n : BigInt(source.startBlock);
  if (options.includeReceipts && source.receiptStartBlock !== void 0 && from < BigInt(source.receiptStartBlock))
    throw new CanonicalSourceUnavailable(
      "Requested receipt history predates the registered receipt history floor."
    );
  const verified = /* @__PURE__ */ new Set();
  for (const anchor of [cursor.completed, cursor.target]) {
    if (!anchor) continue;
    const retained = await retainedAnchor(
      pool,
      release,
      source.chainId,
      anchor
    );
    if (retained === "changed")
      throw new CanonicalCursorInvalidated("Cursor anchor was reorged.");
    if (retained === "expired") {
      if (!options.verifyOldAnchor)
        throw new CanonicalCursorInvalidated(
          "Cursor anchor expired; refresh or verify it against canonical history."
        );
      if (!await options.verifyOldAnchor(anchor, source.chainId))
        throw new CanonicalCursorInvalidated(
          "Cursor anchor is no longer canonical."
        );
      verified.add(`${anchor.number}:${anchor.hash}`);
    }
  }
  return indexerTransaction(
    pool,
    async (db) => {
      const status = await readIndexerSourceStatus(
        db,
        release,
        sourceId,
        policy,
        { nowMs: options.nowMs }
      );
      if (!["ready", "catching_up"].includes(status.readiness.reason) || !status.anchor || status.readiness.availableThroughBlock === null) {
        throw new CanonicalSourceUnavailable(
          status.errorCode ?? status.readiness.reason
        );
      }
      for (const anchor of [cursor.completed, cursor.target]) {
        if (!anchor) continue;
        const retained = await retainedAnchor(
          db,
          release,
          source.chainId,
          anchor
        );
        if (retained !== "valid" && !(retained === "expired" && verified.has(`${anchor.number}:${anchor.hash}`))) {
          throw new CanonicalCursorInvalidated(
            "Canonical cursor evidence changed during paging."
          );
        }
      }
      if (cursor.after) {
        const previous = await db.query(
          `SELECT 1 FROM ${sqlIdentifier(release.schema)}.canonical_event
        WHERE id=$1 AND source_id=$2 AND block_number=$3::bigint AND block_hash=$4 AND transaction_index=$5 AND log_index=$6`,
          [
            cursor.after.id,
            sourceId,
            cursor.after.blockNumber,
            cursor.after.blockHash,
            cursor.after.transactionIndex,
            cursor.after.logIndex
          ]
        );
        if (previous.rowCount !== 1)
          throw new CanonicalCursorInvalidated(
            "Previously applied event was reorged."
          );
      }
      const target = cursor.target ?? {
        number: status.anchor.number,
        hash: status.anchor.hash
      };
      if (BigInt(target.number) > status.readiness.availableThroughBlock)
        throw new CanonicalSourceUnavailable(
          "Indexer is recovering the cursor boundary."
        );
      if (cursor.completed && BigInt(cursor.completed.number) > status.readiness.availableThroughBlock)
        throw new CanonicalSourceUnavailable(
          "Indexer has not recovered the previously completed cursor boundary."
        );
      if (cursor.completed && BigInt(target.number) <= BigInt(cursor.completed.number)) {
        return {
          events: [],
          receipts: [],
          cursor,
          complete: true,
          waitingReceipt: false
        };
      }
      const rows = (await db.query(
        `SELECT e.*,e.block_number::text,e.timestamp::text,
      EXISTS(SELECT 1 FROM ${sqlIdentifier(release.schema)}.transaction_candidate c
        WHERE c.chain_id=e.chain_id AND c.block_hash=e.block_hash AND c.transaction_hash=e.transaction_hash) AS needs_receipt
      FROM ${sqlIdentifier(release.schema)}.canonical_event e
      WHERE e.source_id=$1 AND e.block_number>=$2::bigint AND e.block_number<=$3::bigint
      AND ($4::bigint IS NULL OR (e.block_number,e.transaction_index,e.log_index)>($4::bigint,$5::integer,$6::integer))
      ORDER BY e.block_number,e.transaction_index,e.log_index LIMIT $7`,
        [
          sourceId,
          String(from),
          target.number,
          cursor.after?.blockNumber ?? null,
          cursor.after?.transactionIndex ?? null,
          cursor.after?.logIndex ?? null,
          pageLimit + 1
        ]
      )).rows;
      const requested = [];
      const identities = /* @__PURE__ */ new Set();
      let candidates = rows.slice(0, pageLimit);
      if (options.includeReceipts) {
        for (let index = 0; index < candidates.length; index++) {
          const event = candidates[index];
          if (!event.needs_receipt) continue;
          const key = receiptKey(event.block_hash, event.transaction_hash);
          if (!identities.has(key)) {
            if (requested.length === 16) {
              candidates = candidates.slice(0, index);
              break;
            }
            identities.add(key);
            requested.push({
              blockHash: event.block_hash,
              transactionHash: event.transaction_hash
            });
          }
        }
      }
      const evidence2 = requested.length ? (await db.query(
        `SELECT r.* FROM yunipals_indexer_control.transaction_evidence r
      JOIN jsonb_to_recordset($2::jsonb) AS x("blockHash" text,"transactionHash" text)
        ON r.block_hash=x."blockHash" AND r.transaction_hash=x."transactionHash" WHERE r.chain_id=$1`,
        [source.chainId, JSON.stringify(requested)]
      )).rows : [];
      const byReceipt = new Map(
        evidence2.map((row) => [
          receiptKey(row.block_hash, row.transaction_hash),
          row
        ])
      );
      const events = [];
      const receipts = /* @__PURE__ */ new Map();
      let bytes = 0;
      let waitingReceipt = false;
      for (const row of candidates) {
        if (row.chain_id !== source.chainId || row.address !== source.address || row.abi_hash !== source.abiHash || !source.events.includes(row.name)) {
          throw new CanonicalSourceUnavailable(
            "Indexed event does not match its source decoder."
          );
        }
        const key = receiptKey(row.block_hash, row.transaction_hash);
        const receipt = options.includeReceipts && row.needs_receipt ? byReceipt.get(key) : void 0;
        if (options.includeReceipts && row.needs_receipt && !receipt) {
          waitingReceipt = true;
          break;
        }
        if (receipt && transactionEvidenceHash(receipt.receipt, receipt.block) !== receipt.payload_hash)
          throw new Error("Receipt evidence checksum mismatch.");
        const event = {
          id: row.id,
          sourceId: row.source_id,
          chainId: row.chain_id,
          address: row.address,
          name: row.name,
          args: JSON.parse(row.args),
          abiHash: row.abi_hash,
          blockNumber: row.block_number,
          blockHash: row.block_hash,
          timestamp: row.timestamp,
          transactionHash: row.transaction_hash,
          transactionIndex: row.transaction_index,
          logIndex: row.log_index,
          topics: parseIndexedEventTopics(row.topics),
          data: row.data
        };
        const size = Buffer.byteLength(JSON.stringify(event)) + (receipt && !receipts.has(key) ? Buffer.byteLength(JSON.stringify(receipt)) : 0);
        if (bytes + size > 8e6) {
          if (!events.length)
            throw new Error("Canonical evidence exceeds page budget.");
          break;
        }
        bytes += size;
        events.push(event);
        if (receipt) receipts.set(key, receipt);
      }
      const complete = !waitingReceipt && events.length === rows.length;
      const last = events.at(-1);
      const next = complete ? { ...cursor, completed: target, target: null, after: null } : {
        ...cursor,
        target,
        after: last ? {
          id: last.id,
          blockNumber: last.blockNumber,
          blockHash: last.blockHash,
          transactionIndex: last.transactionIndex,
          logIndex: last.logIndex
        } : cursor.after
      };
      return {
        events,
        receipts: [...receipts.values()],
        cursor: next,
        complete,
        waitingReceipt
      };
    },
    true
  );
}

// accepted264a:packages/yunipals-indexer-server/src/readers.ts
async function createIndexerReader(pool, options = {}) {
  const release = await indexerTransaction(
    pool,
    async (db) => {
      const selected = await loadIndexerRelease(db, options.releaseId);
      await readBoundRuntime(db, selected);
      return selected;
    },
    true
  );
  return {
    release,
    status(sourceId, policy) {
      return indexerSourceStatus(pool, release, sourceId, policy, {
        nowMs: options.now?.()
      });
    },
    page(sourceId, policy, pageOptions) {
      return readCanonicalPage(pool, release, sourceId, policy, {
        nowMs: options.now?.(),
        ...pageOptions
      });
    },
    snapshot(sourceId, policy, read) {
      return indexerTransaction(
        pool,
        async (db) => {
          const status = await readIndexerSourceStatus(
            db,
            release,
            sourceId,
            policy,
            { nowMs: options.now?.() }
          );
          return read(db, { release, status });
        },
        true
      );
    }
  };
}

// accepted264a:packages/yunipals-indexer-server/src/arena.ts
var decimal2 = /^(0|[1-9][0-9]*)$/;
var hash = /^0x[0-9a-f]{64}$/;
function sourceOf(reader, definition) {
  if (!/^0x[0-9a-f]{40}$/.test(definition.contract) || /^0x0{40}$/.test(definition.contract) || !decimal2.test(definition.startBlock) || !hash.test(definition.abiHash))
    throw new Error("Invalid Arena read deployment.");
  const source = reader.release.manifest.sources.find(
    (source2) => source2.id === `arena:8453:${definition.contract}`
  );
  if (!source?.enabled || source.feature !== "arena" || source.chainId !== 8453 || source.address !== definition.contract || source.startBlock !== definition.startBlock || source.abiHash !== definition.abiHash)
    throw new Error(
      "Arena read deployment differs from the registered source."
    );
  return source;
}
function available(status) {
  if (!["ready", "catching_up"].includes(status.readiness.reason) || !status.anchor)
    throw new CanonicalSourceUnavailable(
      `Arena source unavailable: ${status.readiness.reason}.`
    );
}
function eventArgs(row) {
  try {
    const args = JSON.parse(row.args);
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new Error();
    return args;
  } catch {
    throw new CanonicalSourceUnavailable("Arena event payload is invalid.");
  }
}
function evidence(row, source, tournamentId) {
  if (!row || row.source_id !== source.id || row.chain_id !== 8453 || row.address !== source.address || row.abi_hash !== source.abiHash || !source.events.includes(row.name) || !decimal2.test(row.block_number) || !hash.test(row.block_hash) || !hash.test(row.transaction_hash) || !Number.isSafeInteger(row.log_index) || row.log_index < 0 || row.id !== `8453:${source.address}:${row.transaction_hash}:${row.log_index}`)
    throw new CanonicalSourceUnavailable("Arena event evidence is incomplete.");
  const args = eventArgs(row);
  if (!args || typeof args !== "object" || tournamentId !== void 0 && (!("id" in args) || String(args.id) !== tournamentId))
    throw new CanonicalSourceUnavailable(
      "Arena event belongs to another tournament."
    );
  return {
    id: row.id,
    blockNumber: row.block_number,
    blockHash: row.block_hash,
    transactionHash: row.transaction_hash,
    logIndex: row.log_index
  };
}
async function frame(db, reader, status, source) {
  available(status);
  const runtime = await readBoundRuntime(db, reader.release);
  const indexed = runtime.chains.find(
    (chain) => chain.chainId === 8453
  )?.completeThroughBlock;
  if (indexed === null || indexed === void 0)
    throw new CanonicalSourceUnavailable(
      "Arena complete block is unavailable."
    );
  return {
    indexed,
    coverage: {
      releaseId: reader.release.id,
      sourceId: source.id,
      indexedThroughBlock: String(indexed),
      observedThroughBlock: status.anchor.number
    }
  };
}
async function readArenaTransaction(reader, definition, transactionHash, options = {}) {
  const source = sourceOf(reader, definition);
  if (!hash.test(transactionHash) || options.tournamentId !== void 0 && (!decimal2.test(options.tournamentId) || BigInt(options.tournamentId) >= 2n ** 256n) || options.blockNumber === void 0 !== (options.blockHash === void 0) || options.blockNumber !== void 0 && options.blockNumber < 0n || options.blockHash !== void 0 && !hash.test(options.blockHash))
    throw new Error("Invalid Arena transaction proof request.");
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      const { indexed, coverage } = await frame(db, reader, status, source), schema = sqlIdentifier(reader.release.schema);
      const finalizedThroughBlock = status.snapshot.finalized?.blockNumber.toString() ?? null;
      let inclusion = null;
      const empty = {
        ...coverage,
        finalizedThroughBlock,
        events: [],
        origin: null
      };
      if (options.blockNumber !== void 0 && options.blockNumber > indexed)
        return { ...empty, inclusion: "not_indexed" };
      const rows = (await db.query(
        `SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
      FROM ${schema}.canonical_event WHERE source_id=$1 AND chain_id=8453 AND transaction_hash=$2 ORDER BY log_index LIMIT 257`,
        [source.id, transactionHash]
      )).rows;
      if (rows.length > 256)
        throw new CanonicalSourceUnavailable(
          "Arena transaction event limit exceeded."
        );
      const events = rows.map((row) => ({
        ...evidence(row, source),
        name: row.name,
        args: eventArgs(row)
      }));
      if (events.some((event) => BigInt(event.blockNumber) > indexed))
        return { ...empty, inclusion: "not_indexed" };
      if (options.blockNumber !== void 0) {
        const witness = (await db.query(
          `SELECT block_hash FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1`,
          [String(options.blockNumber)]
        )).rows[0];
        inclusion = witness ? witness.block_hash === options.blockHash ? "canonical" : "changed" : events.some(
          (event) => event.blockNumber === String(options.blockNumber) && event.blockHash === options.blockHash
        ) ? "canonical" : "expired";
        if (events.some(
          (event) => event.blockNumber !== String(options.blockNumber) || event.blockHash !== options.blockHash
        ))
          inclusion = "changed";
      }
      let origin = null;
      if (options.tournamentId !== void 0) {
        const row = (await db.query(
          `SELECT opened_event_id,opened_block_hash,block_number::text FROM ${schema}.arena_tournament WHERE deployment=$1 AND tournament_id=$2`,
          [`8453:${definition.contract}`, options.tournamentId]
        )).rows[0];
        if (row) {
          if (!decimal2.test(row.block_number) || BigInt(row.block_number) > indexed)
            return { ...empty, inclusion: "not_indexed" };
          const opening = (await db.query(
            `SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
          FROM ${schema}.canonical_event WHERE id=$1`,
            [row.opened_event_id]
          )).rows[0];
          const opened = evidence(opening, source, options.tournamentId);
          if (opening.name !== "TournamentOpened" || opened.blockHash !== row.opened_block_hash || BigInt(opened.blockNumber) > indexed)
            throw new CanonicalSourceUnavailable(
              "Arena transaction opening proof is invalid."
            );
          if (events.some(
            (event) => String(event.args.id) === options.tournamentId && event.name !== "TournamentOpened" && (BigInt(event.blockNumber) < BigInt(opened.blockNumber) || event.blockNumber === opened.blockNumber && event.logIndex <= opened.logIndex)
          ))
            throw new CanonicalSourceUnavailable(
              "Arena transaction predates its current opening."
            );
          origin = {
            opened,
            incarnation: manifestDigest({
              deployment: `8453:${definition.contract}`,
              tournamentId: options.tournamentId,
              openedEventId: opened.id,
              openedBlockHash: opened.blockHash
            })
          };
        }
      }
      return { ...coverage, finalizedThroughBlock, inclusion, events, origin };
    }
  );
}
async function readArenaCredit(reader, definition, wallet) {
  const source = sourceOf(reader, definition);
  if (!/^0x[0-9a-f]{40}$/.test(wallet))
    throw new Error("Invalid Arena credit wallet.");
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      const { indexed, coverage } = await frame(db, reader, status, source), schema = sqlIdentifier(reader.release.schema);
      const row = (await db.query(
        `SELECT amount::text,last_event_id,block_number::text,block_hash FROM ${schema}.arena_credit WHERE deployment=$1 AND wallet=$2`,
        [`8453:${definition.contract}`, wallet]
      )).rows[0];
      if (!row) return { ...coverage, amount: "0", last: null };
      if (!decimal2.test(row.amount) || BigInt(row.amount) >= 2n ** 256n || !decimal2.test(row.block_number) || BigInt(row.block_number) > indexed)
        throw new CanonicalSourceUnavailable(
          "Arena credit exceeds complete indexing coverage."
        );
      const event = (await db.query(
        `SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
      FROM ${schema}.canonical_event WHERE id=$1`,
        [row.last_event_id]
      )).rows[0];
      if (!event || !["Claimed", "PayoutsReleased", "TournamentExpired"].includes(
        event.name
      ))
        throw new CanonicalSourceUnavailable(
          "Arena credit event proof is incomplete."
        );
      const args = eventArgs(event);
      if (!args || typeof args !== "object" || event.name === "Claimed" && (!("player" in args) || String(args.player).toLowerCase() !== wallet))
        throw new CanonicalSourceUnavailable(
          "Arena credit event wallet disagrees."
        );
      const eventId = event.name === "Claimed" ? "0" : String("id" in args ? args.id : "");
      const last = evidence(
        event,
        source,
        event.name === "Claimed" ? void 0 : eventId
      );
      if (last.blockNumber !== row.block_number || last.blockHash !== row.block_hash)
        throw new CanonicalSourceUnavailable(
          "Arena credit and event inclusion disagree."
        );
      return { ...coverage, amount: row.amount, last };
    }
  );
}
async function readArenaTournamentIds(reader, definition, options = {}) {
  const source = sourceOf(reader, definition), limit = options.limit ?? 30;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || options.wallet !== void 0 && !/^0x[0-9a-f]{40}$/.test(options.wallet))
    throw new Error("Invalid Arena tournament list.");
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      const { indexed, coverage } = await frame(db, reader, status, source), schema = sqlIdentifier(reader.release.schema);
      if ((await db.query(
        `SELECT 1 FROM ${schema}.arena_tournament WHERE deployment=$1 AND block_number>$2 LIMIT 1`,
        [`8453:${definition.contract}`, String(indexed)]
      )).rowCount)
        throw new CanonicalSourceUnavailable(
          "Arena list is still indexing the current block."
        );
      const rows = (await db.query(
        `SELECT tournament_id AS id FROM ${schema}.arena_tournament WHERE deployment=$1
      ${options.workOnly ? `AND (state->>'phase' IN ('open','strategies','resolving') OR (state->>'phase'='settled' AND state->>'videoHash' IS NULL))` : ""}
      ${options.wallet ? `AND (state->>'islandBeneficiary'=$3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(state->'seats') seat WHERE seat->>'player'=$3))` : ""}
      ORDER BY tournament_id::numeric ${options.workOnly ? "ASC" : "DESC"} LIMIT $2`,
        [
          `8453:${definition.contract}`,
          limit,
          ...options.wallet ? [options.wallet] : []
        ]
      )).rows;
      return { ...coverage, ids: rows.map((row) => row.id) };
    }
  );
}
async function readArenaTournament(reader, definition, tournamentId, options = {}) {
  const source = sourceOf(reader, definition);
  if (!decimal2.test(tournamentId) || BigInt(tournamentId) >= 2n ** 256n)
    throw new Error("Invalid Arena tournament ID.");
  if (options.requiredThroughBlock !== void 0 && options.requiredThroughBlock < 0n || options.expectedIncarnation !== void 0 && !hash.test(options.expectedIncarnation))
    throw new Error("Invalid Arena read requirement.");
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      available(status);
      const runtime = await readBoundRuntime(db, reader.release);
      const indexed = runtime.chains.find(
        (chain) => chain.chainId === 8453
      )?.completeThroughBlock;
      if (indexed === void 0 || indexed === null || options.requiredThroughBlock !== void 0 && indexed < options.requiredThroughBlock)
        throw new CanonicalSourceUnavailable(
          "Arena is still indexing the required block."
        );
      const deployment = `8453:${definition.contract}`, schema = sqlIdentifier(reader.release.schema);
      const row = (await db.query(
        `SELECT state,opened_event_id,opened_block_hash,last_event_id,
      block_number::text,block_hash FROM ${schema}.arena_tournament WHERE deployment=$1 AND tournament_id=$2`,
        [deployment, tournamentId]
      )).rows[0];
      const coverage = {
        releaseId: reader.release.id,
        sourceId: source.id,
        indexedThroughBlock: indexed.toString(),
        observedThroughBlock: status.anchor.number
      };
      if (!row) {
        if (options.expectedIncarnation)
          throw new CanonicalSourceUnavailable(
            "Arena tournament is no longer canonical."
          );
        return { ...coverage, tournament: null };
      }
      if (!decimal2.test(row.block_number) || BigInt(row.block_number) > indexed)
        throw new CanonicalSourceUnavailable(
          "Arena tournament exceeds complete indexing coverage."
        );
      const events = (await db.query(
        `SELECT id,source_id,chain_id,address,abi_hash,name,args,
      block_number::text,block_hash,transaction_hash,log_index FROM ${schema}.canonical_event WHERE id=ANY($1::text[])`,
        [[row.opened_event_id, row.last_event_id]]
      )).rows;
      const openedRow = events.find(
        (event) => event.id === row.opened_event_id
      );
      const opened = evidence(openedRow, source, tournamentId), last = evidence(
        events.find((event) => event.id === row.last_event_id),
        source,
        tournamentId
      );
      if (openedRow.name !== "TournamentOpened" || opened.blockHash !== row.opened_block_hash || last.blockHash !== row.block_hash || last.blockNumber !== row.block_number || BigInt(opened.blockNumber) > BigInt(last.blockNumber))
        throw new CanonicalSourceUnavailable(
          "Arena state and event evidence disagree."
        );
      if (!row.state || typeof row.state !== "object" || !("id" in row.state) || String(row.state.id) !== tournamentId)
        throw new CanonicalSourceUnavailable(
          "Arena tournament state identity is invalid."
        );
      const incarnation = manifestDigest({
        deployment,
        tournamentId,
        openedEventId: opened.id,
        openedBlockHash: opened.blockHash
      });
      let inputFrozen = null;
      if ("inputHash" in row.state && row.state.inputHash !== null && row.state.inputHash !== void 0) {
        const frozenRow = (await db.query(
          `SELECT id,source_id,chain_id,address,abi_hash,name,args,
          block_number::text,block_hash,transaction_hash,log_index FROM ${schema}.canonical_event
          WHERE source_id=$1 AND name='InputFrozen' AND args::jsonb->>'id'=$2
          ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1`,
          [source.id, tournamentId]
        )).rows[0];
        inputFrozen = evidence(frozenRow, source, tournamentId);
        const args = JSON.parse(frozenRow.args);
        if (!args || typeof args !== "object" || !("inputHash" in args) || !("strategyCommitments" in args) || args.inputHash !== row.state.inputHash || !("commitments" in row.state) || JSON.stringify(args.strategyCommitments) !== JSON.stringify(row.state.commitments) || BigInt(inputFrozen.blockNumber) > BigInt(last.blockNumber) || inputFrozen.blockNumber === last.blockNumber && inputFrozen.logIndex > last.logIndex)
          throw new CanonicalSourceUnavailable(
            "Arena frozen input evidence disagrees with public state."
          );
      }
      if (options.expectedIncarnation && options.expectedIncarnation !== incarnation)
        throw new CanonicalSourceUnavailable(
          "Arena tournament incarnation changed."
        );
      return {
        ...coverage,
        tournament: {
          deployment,
          id: tournamentId,
          state: row.state,
          incarnation,
          opened,
          last,
          inputFrozen
        }
      };
    }
  );
}
async function readArenaBrowse(reader, definition, request) {
  const source = sourceOf(reader, definition), limit = request.limit ?? 25;
  if (!["tournaments", "wallet", "island", "timeline", "rewards"].includes(
    request.kind
  ) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || request.wallet !== void 0 && !/^0x[0-9a-f]{40}$/.test(request.wallet) || [request.before, request.islandId, request.tournamentId].some(
    (v) => v != null && (!decimal2.test(v) || BigInt(v) >= 2n ** 256n)
  ) || request.role !== void 0 && !["any", "entrant", "host"].includes(request.role) || request.status !== void 0 && !["all", "active", "completed", "refunded"].includes(request.status) || ["wallet", "rewards"].includes(request.kind) && !request.wallet || request.kind === "island" && !request.islandId || request.kind === "timeline" && !request.tournamentId || request.cursorAnchor !== void 0 && (!decimal2.test(request.cursorAnchor.number) || !hash.test(request.cursorAnchor.hash)) || request.role && request.role !== "any" && !request.wallet)
    throw new Error("Invalid Arena public browse request.");
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      const { indexed, coverage } = await frame(db, reader, status, source), schema = sqlIdentifier(reader.release.schema), deployment = `8453:${definition.contract}`;
      if ((await db.query(
        `SELECT 1 FROM ${schema}.arena_tournament WHERE deployment=$1 AND block_number>$2
       UNION ALL SELECT 1 FROM ${schema}.arena_credit WHERE deployment=$1 AND block_number>$2 LIMIT 1`,
        [deployment, String(indexed)]
      )).rowCount)
        throw new CanonicalSourceUnavailable(
          "Arena public history is still indexing the current block."
        );
      if (request.cursorAnchor && (BigInt(request.cursorAnchor.number) > indexed || (await db.query(
        `SELECT 1 FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1 AND block_hash=$2`,
        [request.cursorAnchor.number, request.cursorAnchor.hash]
      )).rowCount !== 1))
        throw new CanonicalSourceUnavailable(
          "Arena history cursor anchor changed or expired."
        );
      const currentAnchor = request.cursorAnchor ?? {
        number: status.anchor.number,
        hash: status.anchor.hash
      };
      if (BigInt(currentAnchor.number) > indexed || (await db.query(
        `SELECT 1 FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1 AND block_hash=$2`,
        [currentAnchor.number, currentAnchor.hash]
      )).rowCount !== 1)
        throw new CanonicalSourceUnavailable(
          "Arena history canonical anchor is unavailable."
        );
      if ((await db.query(
        `SELECT 1 FROM ${schema}.arena_tournament t
      LEFT JOIN ${schema}.canonical_event o ON o.id=t.opened_event_id
      LEFT JOIN ${schema}.canonical_event e ON e.id=t.last_event_id
      WHERE t.deployment=$1 AND NOT COALESCE(
        o.name='TournamentOpened' AND o.source_id=$2 AND e.source_id=$2
        AND o.chain_id=8453 AND e.chain_id=8453 AND o.address=$3 AND e.address=$3 AND o.abi_hash=$4 AND e.abi_hash=$4
        AND o.args::jsonb->>'id'=t.tournament_id AND e.args::jsonb->>'id'=t.tournament_id AND t.state->>'id'=t.tournament_id
        AND o.block_hash=t.opened_block_hash AND e.block_hash=t.block_hash AND e.block_number=t.block_number
        AND o.block_number<=e.block_number AND e.block_number<=$5
        AND (o.block_number<e.block_number OR o.log_index<=e.log_index),false) LIMIT 1`,
        [
          deployment,
          source.id,
          definition.contract,
          definition.abiHash,
          String(indexed)
        ]
      )).rowCount)
        throw new CanonicalSourceUnavailable(
          "Arena history aggregate evidence disagrees."
        );
      if ((await db.query(
        `SELECT 1 FROM ${schema}.arena_credit c LEFT JOIN ${schema}.canonical_event e ON e.id=c.last_event_id
      WHERE c.deployment=$1 AND NOT COALESCE(e.source_id=$2 AND e.chain_id=8453 AND e.address=$3 AND e.abi_hash=$4
       AND e.name IN ('Claimed','PayoutsReleased','TournamentExpired') AND e.block_hash=c.block_hash AND e.block_number=c.block_number
       AND e.block_number<=$5 AND (e.name<>'Claimed' OR lower(e.args::jsonb->>'player')=c.wallet),false) LIMIT 1`,
        [
          deployment,
          source.id,
          definition.contract,
          definition.abiHash,
          String(indexed)
        ]
      )).rowCount)
        throw new CanonicalSourceUnavailable(
          "Arena history credit evidence disagrees."
        );
      const result = {
        ...coverage,
        cursorAnchor: currentAnchor,
        rows: [],
        events: [],
        totals: null,
        island: null,
        amount: "0",
        withdrawals: "0"
      };
      if (request.kind === "island") {
        result.island = (await db.query(
          `SELECT count(*)::text AS hosted,
       (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL)*400000)::text AS released,
       (count(*) FILTER(WHERE state->>'phase'='settled' AND state->>'videoHash' IS NULL)*400000)::text AS pending
       FROM ${schema}.arena_tournament WHERE deployment=$1 AND state->>'islandId'=$2`,
          [deployment, request.islandId]
        )).rows[0];
      }
      if (request.kind === "tournaments" || request.kind === "island") {
        const rows = (await db.query(
          `SELECT tournament_id AS id,state,opened_event_id,opened_block_hash,last_event_id,block_number::text,block_hash
       FROM ${schema}.arena_tournament t WHERE deployment=$1 AND ($2::numeric IS NULL OR tournament_id::numeric<$2)
       AND ($3::text IS NULL OR ($4 IN ('any','entrant') AND EXISTS(SELECT 1 FROM jsonb_array_elements(state->'seats') s WHERE s->>'player'=$3))
         OR ($4 IN ('any','host') AND state->>'islandBeneficiary'=$3))
       AND ($5='all' OR ($5='active' AND state->>'phase' IN ('open','strategies','resolving'))
         OR ($5='completed' AND state->>'phase'='settled') OR ($5='refunded' AND state->>'phase'='expired'))
       AND ($6::text IS NULL OR state->>'islandId'=$6) ORDER BY tournament_id::numeric DESC LIMIT $7`,
          [
            deployment,
            request.before ?? null,
            request.wallet ?? null,
            request.role ?? "any",
            request.status ?? "all",
            request.islandId ?? null,
            limit
          ]
        )).rows;
        const events = rows.length ? (await db.query(
          `SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
       FROM ${schema}.canonical_event WHERE id=ANY($1::text[])`,
          [rows.flatMap((r) => [r.opened_event_id, r.last_event_id])]
        )).rows : [];
        result.rows = await Promise.all(
          rows.map(async (row) => {
            const opening = events.find((e) => e.id === row.opened_event_id), opened = evidence(opening, source, row.id), last = evidence(
              events.find((e) => e.id === row.last_event_id),
              source,
              row.id
            );
            if (opening?.name !== "TournamentOpened" || opened.blockHash !== row.opened_block_hash || last.blockHash !== row.block_hash || last.blockNumber !== row.block_number || BigInt(last.blockNumber) > indexed || BigInt(opened.blockNumber) > BigInt(last.blockNumber) || !row.state || typeof row.state !== "object" || !("id" in row.state) || row.state.id !== row.id)
              throw new CanonicalSourceUnavailable(
                "Arena public history evidence disagrees."
              );
            let inputFrozen = null;
            if ("inputHash" in row.state && row.state.inputHash != null) {
              const frozen = (await db.query(
                `SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
            FROM ${schema}.canonical_event WHERE source_id=$1 AND name='InputFrozen' AND args::jsonb->>'id'=$2
            ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1`,
                [source.id, row.id]
              )).rows[0];
              inputFrozen = evidence(frozen, source, row.id);
              const args = eventArgs(frozen);
              if (args.inputHash !== row.state.inputHash || !("commitments" in row.state) || JSON.stringify(args.strategyCommitments) !== JSON.stringify(row.state.commitments) || BigInt(inputFrozen.blockNumber) > BigInt(last.blockNumber) || BigInt(inputFrozen.blockNumber) < BigInt(opened.blockNumber) || inputFrozen.blockNumber === opened.blockNumber && inputFrozen.logIndex <= opened.logIndex || inputFrozen.blockNumber === last.blockNumber && inputFrozen.logIndex > last.logIndex)
                throw new CanonicalSourceUnavailable(
                  "Arena history frozen input disagrees."
                );
            }
            return {
              id: row.id,
              state: row.state,
              inputFrozen,
              incarnation: manifestDigest({
                deployment,
                tournamentId: row.id,
                openedEventId: opened.id,
                openedBlockHash: opened.blockHash
              })
            };
          })
        );
      } else if (request.kind === "wallet") {
        result.totals = (await db.query(
          `WITH participants AS (
        SELECT state,(SELECT count(*) FROM jsonb_array_elements(state->'seats') s WHERE s->>'player'=$2) AS own,
         state->>'islandBeneficiary'=$2 AS host,state->>'treasury'=$2 AS treasury,
         state->'seats'->((state->'winners'->>2)::int)->>'player'=$2 AS winner
        FROM ${schema}.arena_tournament WHERE deployment=$1)
       SELECT count(*) FILTER(WHERE own>0)::text AS entered_tournaments,coalesce(sum(own),0)::text AS entered_seats,
        count(*) FILTER(WHERE host)::text AS hosted_tournaments,count(*) FILTER(WHERE state->>'phase'='settled' AND winner)::text AS championships,
        (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL AND winner)*6000000)::text AS winnings,
        (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL AND host)*400000)::text AS hosting,
        (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL AND treasury)*1600000)::text AS operations,
        coalesce(sum(own*2000000) FILTER(WHERE state->>'phase'='expired'),0)::text AS refunds,
        coalesce(sum((CASE WHEN winner THEN 6000000 ELSE 0 END)+(CASE WHEN host THEN 400000 ELSE 0 END)+(CASE WHEN treasury THEN 1600000 ELSE 0 END))
          FILTER(WHERE state->>'phase'='settled' AND state->>'videoHash' IS NULL),0)::text AS pending FROM participants`,
          [deployment, request.wallet]
        )).rows[0];
        result.amount = (await db.query(
          `SELECT amount::text FROM ${schema}.arena_credit WHERE deployment=$1 AND wallet=$2`,
          [deployment, request.wallet]
        )).rows[0]?.amount ?? "0";
        result.withdrawals = (await db.query(
          `SELECT coalesce(sum((args::jsonb->>'amount')::numeric),0)::text AS amount
       FROM ${schema}.canonical_event WHERE source_id=$1 AND name='Claimed' AND lower(args::jsonb->>'player')=$2 AND block_number<=$3`,
          [source.id, request.wallet, String(indexed)]
        )).rows[0].amount;
      } else {
        const rows = (await db.query(
          `SELECT e.id,e.source_id,e.chain_id,e.address,e.abi_hash,e.name,e.args,e.block_number::text,e.block_hash,e.transaction_hash,e.log_index,t.state
       FROM ${schema}.canonical_event e LEFT JOIN ${schema}.arena_tournament t ON t.deployment=$1 AND t.tournament_id=e.args::jsonb->>'id'
       LEFT JOIN ${schema}.canonical_event o ON o.id=t.opened_event_id
       WHERE e.source_id=$2 AND e.block_number<=$3
       AND (e.name='Claimed' OR (e.block_number>o.block_number OR (e.block_number=o.block_number AND e.log_index>=o.log_index)))
       AND ($4::numeric IS NULL OR e.block_number::numeric*4294967296+e.log_index+1<$4)
       AND (${request.kind === "timeline" ? "e.args::jsonb->>'id'=$5" : "e.name IN ('PayoutsReleased','TournamentExpired','Claimed') AND ((e.name='Claimed' AND lower(e.args::jsonb->>'player')=$5) OR (e.name<>'Claimed' AND (t.state->>'islandBeneficiary'=$5 OR t.state->>'treasury'=$5 OR EXISTS(SELECT 1 FROM jsonb_array_elements(t.state->'seats') s WHERE s->>'player'=$5))))"})
       ORDER BY e.block_number ${request.kind === "timeline" ? "ASC" : "DESC"},e.log_index ${request.kind === "timeline" ? "ASC" : "DESC"} LIMIT $6`,
          [
            deployment,
            source.id,
            String(indexed),
            request.before ?? null,
            request.kind === "timeline" ? request.tournamentId : request.wallet,
            limit
          ]
        )).rows;
        result.events = rows.map((row) => {
          evidence(
            row,
            source,
            request.kind === "timeline" ? request.tournamentId : void 0
          );
          return {
            n: String(
              BigInt(row.block_number) * 4294967296n + BigInt(row.log_index) + 1n
            ),
            event_name: row.name,
            args: eventArgs(row),
            transaction_hash: row.transaction_hash,
            block_number: row.block_number,
            log_index: row.log_index,
            state: row.state
          };
        });
      }
      return result;
    }
  );
}

// accepted264a:packages/yunipals-market-core/src/arenaAbi.ts
var arenaAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "c",
        type: "tuple",
        internalType: "struct YunipalsArena.Config",
        components: [
          {
            name: "admin",
            type: "address",
            internalType: "address"
          },
          {
            name: "lobbyOperator",
            type: "address",
            internalType: "address"
          },
          {
            name: "admissionSigner",
            type: "address",
            internalType: "address"
          },
          {
            name: "referee",
            type: "address",
            internalType: "address"
          },
          {
            name: "treasury",
            type: "address",
            internalType: "address"
          },
          {
            name: "islands",
            type: "address",
            internalType: "address"
          },
          {
            name: "vrfWrapper",
            type: "address",
            internalType: "address"
          },
          {
            name: "paymentToken",
            type: "address",
            internalType: "address"
          },
          {
            name: "entryFee",
            type: "uint128",
            internalType: "uint128"
          },
          {
            name: "winnerBps",
            type: "uint16",
            internalType: "uint16"
          },
          {
            name: "islandBps",
            type: "uint16",
            internalType: "uint16"
          },
          {
            name: "joinWindow",
            type: "uint32",
            internalType: "uint32"
          },
          {
            name: "strategyWindow",
            type: "uint32",
            internalType: "uint32"
          },
          {
            name: "resolutionWindow",
            type: "uint32",
            internalType: "uint32"
          },
          {
            name: "maxVrfCost",
            type: "uint128",
            internalType: "uint128"
          },
          {
            name: "rulesHash",
            type: "bytes32",
            internalType: "bytes32"
          }
        ]
      }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "receive",
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "BASE_YUNIPALS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "CALLBACK_GAS_LIMIT",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "DRAW_DOMAIN",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "ENTRY_TYPEHASH",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "FALLBACK_COMMITMENT_DOMAIN",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "FALLBACK_DOMAIN",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "OTHER_YUNIPALS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "REQUEST_CONFIRMATIONS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "STRATEGY_TYPEHASH",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "acceptOwnership",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "activeNftTournament",
    inputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "admissionSigner",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "automaticStrategyMask",
    inputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "uint8"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "availableVrfFunds",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "claim",
    inputs: [
      {
        name: "recipient",
        type: "address",
        internalType: "address payable"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "claimable",
    inputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "drawTicket",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "word",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "eip712Domain",
    inputs: [],
    outputs: [
      {
        name: "fields",
        type: "bytes1",
        internalType: "bytes1"
      },
      {
        name: "name",
        type: "string",
        internalType: "string"
      },
      {
        name: "version",
        type: "string",
        internalType: "string"
      },
      {
        name: "chainId",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "verifyingContract",
        type: "address",
        internalType: "address"
      },
      {
        name: "salt",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "extensions",
        type: "uint256[]",
        internalType: "uint256[]"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "entries",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "tuple[4]",
        internalType: "struct YunipalsArena.Entry[4]",
        components: [
          {
            name: "player",
            type: "address",
            internalType: "address"
          },
          {
            name: "nftChainId",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "collection",
            type: "address",
            internalType: "address"
          },
          {
            name: "tokenId",
            type: "uint256",
            internalType: "uint256"
          }
        ]
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "entriesPaused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "entryDigest",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "e",
        type: "tuple",
        internalType: "struct YunipalsArena.Entry",
        components: [
          {
            name: "player",
            type: "address",
            internalType: "address"
          },
          {
            name: "nftChainId",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "collection",
            type: "address",
            internalType: "address"
          },
          {
            name: "tokenId",
            type: "uint256",
            internalType: "uint256"
          }
        ]
      },
      {
        name: "expiry",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "entryFee",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint128",
        internalType: "uint128"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "expire",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "fallbackAttack",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "seat",
        type: "uint8",
        internalType: "uint8"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "uint8"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "fallbackCommitment",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "seat",
        type: "uint8",
        internalType: "uint8"
      }
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "finalizeIsland",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "freezeInput",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "inputHash",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "commitments",
        type: "bytes32[4]",
        internalType: "bytes32[4]"
      },
      {
        name: "signatures",
        type: "bytes[4]",
        internalType: "bytes[4]"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "freezeInputWithFallback",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "inputHash",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "commitments",
        type: "bytes32[4]",
        internalType: "bytes32[4]"
      },
      {
        name: "signatures",
        type: "bytes[4]",
        internalType: "bytes[4]"
      },
      {
        name: "seatMask",
        type: "uint8",
        internalType: "uint8"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "getBalance",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getLinkToken",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract LinkTokenInterface"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "i_vrfV2PlusWrapper",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IVRFV2PlusWrapper"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "islandBps",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "islandForTicket",
    inputs: [
      {
        name: "ticket",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16"
      }
    ],
    stateMutability: "pure"
  },
  {
    type: "function",
    name: "islands",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IERC721"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "join",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "e",
        type: "tuple",
        internalType: "struct YunipalsArena.Entry",
        components: [
          {
            name: "player",
            type: "address",
            internalType: "address"
          },
          {
            name: "nftChainId",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "collection",
            type: "address",
            internalType: "address"
          },
          {
            name: "tokenId",
            type: "uint256",
            internalType: "uint256"
          }
        ]
      },
      {
        name: "expiry",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "permit",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "joinWindow",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "lobbyOperator",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "maxVrfCost",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint128",
        internalType: "uint128"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "nextTournamentId",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "nftKey",
    inputs: [
      {
        name: "e",
        type: "tuple",
        internalType: "struct YunipalsArena.Entry",
        components: [
          {
            name: "player",
            type: "address",
            internalType: "address"
          },
          {
            name: "nftChainId",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "collection",
            type: "address",
            internalType: "address"
          },
          {
            name: "tokenId",
            type: "uint256",
            internalType: "uint256"
          }
        ]
      }
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "pure"
  },
  {
    type: "function",
    name: "openTournament",
    inputs: [],
    outputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "paymentLiability",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "paymentToken",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "pendingOwner",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "poolHash",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "pure"
  },
  {
    type: "function",
    name: "publishedVideoHash",
    inputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "rawFulfillRandomWords",
    inputs: [
      {
        name: "_requestId",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "_randomWords",
        type: "uint256[]",
        internalType: "uint256[]"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "referee",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "releasePayouts",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "videoHash",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "renounceOwnership",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "requestTournament",
    inputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "resolutionWindow",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "rulesHash",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "setEntriesPaused",
    inputs: [
      {
        name: "paused",
        type: "bool",
        internalType: "bool"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "setLobbyOperator",
    inputs: [
      {
        name: "newOperator",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "setTreasury",
    inputs: [
      {
        name: "newTreasury",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "settle",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "resultHash",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "semiOne",
        type: "uint8",
        internalType: "uint8"
      },
      {
        name: "semiTwo",
        type: "uint8",
        internalType: "uint8"
      },
      {
        name: "champion",
        type: "uint8",
        internalType: "uint8"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "strategyDigest",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "seat",
        type: "uint8",
        internalType: "uint8"
      },
      {
        name: "commitment",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "strategyWindow",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "supportedCollection",
    inputs: [
      {
        name: "chainId",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "collection",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool"
      }
    ],
    stateMutability: "pure"
  },
  {
    type: "function",
    name: "tournament",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct YunipalsArena.Tournament",
        components: [
          {
            name: "phase",
            type: "uint8",
            internalType: "enum YunipalsArena.Phase"
          },
          {
            name: "count",
            type: "uint8",
            internalType: "uint8"
          },
          {
            name: "islandId",
            type: "uint16",
            internalType: "uint16"
          },
          {
            name: "randomnessReceived",
            type: "bool",
            internalType: "bool"
          },
          {
            name: "deadline",
            type: "uint64",
            internalType: "uint64"
          },
          {
            name: "islandBeneficiary",
            type: "address",
            internalType: "address"
          },
          {
            name: "treasuryBeneficiary",
            type: "address",
            internalType: "address"
          },
          {
            name: "requestId",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "randomWord",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "inputHash",
            type: "bytes32",
            internalType: "bytes32"
          },
          {
            name: "resultHash",
            type: "bytes32",
            internalType: "bytes32"
          },
          {
            name: "semifinalOneWinner",
            type: "uint8",
            internalType: "uint8"
          },
          {
            name: "semifinalTwoWinner",
            type: "uint8",
            internalType: "uint8"
          },
          {
            name: "champion",
            type: "uint8",
            internalType: "uint8"
          }
        ]
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "transferOwnership",
    inputs: [
      {
        name: "newOwner",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "treasury",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "winnerBps",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "withdrawVrfFunds",
    inputs: [
      {
        name: "recipient",
        type: "address",
        internalType: "address payable"
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "event",
    name: "AutomaticStrategiesAssigned",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "seatMask",
        type: "uint8",
        indexed: false,
        internalType: "uint8"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      {
        name: "player",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "EIP712DomainChanged",
    inputs: [],
    anonymous: false
  },
  {
    type: "event",
    name: "Entered",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "seat",
        type: "uint8",
        indexed: true,
        internalType: "uint8"
      },
      {
        name: "player",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "nftChainId",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "collection",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "tokenId",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "EntryPauseChanged",
    inputs: [
      {
        name: "paused",
        type: "bool",
        indexed: false,
        internalType: "bool"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "InputFrozen",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "inputHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "strategyCommitments",
        type: "bytes32[4]",
        indexed: false,
        internalType: "bytes32[4]"
      },
      {
        name: "deadline",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "IslandRequested",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "cost",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "IslandSelected",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "islandId",
        type: "uint16",
        indexed: true,
        internalType: "uint16"
      },
      {
        name: "ticket",
        type: "uint16",
        indexed: false,
        internalType: "uint16"
      },
      {
        name: "beneficiary",
        type: "address",
        indexed: false,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "JoinWindowStarted",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "deadline",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "LobbyOperatorChanged",
    inputs: [
      {
        name: "previousOperator",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newOperator",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "OwnershipTransferStarted",
    inputs: [
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "OwnershipTransferred",
    inputs: [
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "PayoutsReleased",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "videoHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RandomnessReceived",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "word",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "ResultSettled",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "resultHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "semifinalOneWinner",
        type: "uint8",
        indexed: false,
        internalType: "uint8"
      },
      {
        name: "semifinalTwoWinner",
        type: "uint8",
        indexed: false,
        internalType: "uint8"
      },
      {
        name: "champion",
        type: "uint8",
        indexed: false,
        internalType: "uint8"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "StrategiesOpened",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "deadline",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "TournamentExpired",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "TournamentOpened",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "rulesHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "poolHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "deadline",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "TournamentTreasuryAssigned",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "beneficiary",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "TreasuryChanged",
    inputs: [
      {
        name: "previousTreasury",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newTreasury",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "error",
    name: "DeadlinePassed",
    inputs: []
  },
  {
    type: "error",
    name: "IncorrectPayment",
    inputs: []
  },
  {
    type: "error",
    name: "InsufficientVrfFunding",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidConfig",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidEntry",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidShortString",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidSignature",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidState",
    inputs: []
  },
  {
    type: "error",
    name: "OnlyVRFWrapperCanFulfill",
    inputs: [
      {
        name: "have",
        type: "address",
        internalType: "address"
      },
      {
        name: "want",
        type: "address",
        internalType: "address"
      }
    ]
  },
  {
    type: "error",
    name: "OwnableInvalidOwner",
    inputs: [
      {
        name: "owner",
        type: "address",
        internalType: "address"
      }
    ]
  },
  {
    type: "error",
    name: "OwnableUnauthorizedAccount",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address"
      }
    ]
  },
  {
    type: "error",
    name: "ReentrancyGuardReentrantCall",
    inputs: []
  },
  {
    type: "error",
    name: "SafeCastOverflowedUintDowncast",
    inputs: [
      {
        name: "bits",
        type: "uint8",
        internalType: "uint8"
      },
      {
        name: "value",
        type: "uint256",
        internalType: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address"
      }
    ]
  },
  {
    type: "error",
    name: "StringTooLong",
    inputs: [
      {
        name: "str",
        type: "string",
        internalType: "string"
      }
    ]
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: []
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: []
  }
];

// accepted264a:apps/yunipals-market-api/src/arena/live/nativeSource.ts
var decimal3 = (value) => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) < 2n ** 256n;
var hash2 = (value) => typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
var address = (value) => typeof value === "string" && /^0x[0-9a-f]{40}$/.test(value);
var integer = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
var record = (value) => !!value && typeof value === "object" && !Array.isArray(value);
function arenaNativeConfiguration(env = process.env) {
  const mode = env.ARENA_INDEXER_MODE ?? "legacy";
  if (mode !== "legacy" && mode !== "unified")
    throw new Error("Invalid Arena indexer mode.");
  if (mode === "legacy") {
    if (env.ARENA_INDEXER_DATABASE_URL || env.ARENA_INDEXER_RELEASE_ID || env.ARENA_INDEXER_SOURCE_KIND)
      throw new Error("Native Arena selectors require explicit unified mode.");
    return { mode };
  }
  if (!env.ARENA_INDEXER_DATABASE_URL || !hash2(env.ARENA_INDEXER_RELEASE_ID))
    throw new Error(
      "Native Arena requires a database and pinned release identity."
    );
  const sourceKind = env.ARENA_INDEXER_SOURCE_KIND ?? "unified";
  if (sourceKind !== "unified" && sourceKind !== "legacy_rollback")
    throw new Error("Invalid Arena public source kind.");
  let url;
  try {
    url = new URL(env.ARENA_INDEXER_DATABASE_URL);
  } catch {
    throw new Error("Invalid native Arena database URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Invalid native Arena database protocol.");
  return {
    mode,
    sourceKind,
    databaseUrl: env.ARENA_INDEXER_DATABASE_URL,
    releaseId: env.ARENA_INDEXER_RELEASE_ID
  };
}
function nativeTournamentState(value) {
  if (!record(value) || !decimal3(value.id) || !["open", "strategies", "resolving", "settled", "expired"].includes(
    String(value.phase)
  ) || !integer(value.deadline) || !hash2(value.rulesHash) || !hash2(value.poolHash) || ![value.treasury, value.islandBeneficiary].every(
    (item) => item === null || address(item)
  ) || ![value.islandId, value.requestId, value.randomWord].every(
    (item) => item === null || decimal3(item)
  ) || !(value.ticket === null || integer(value.ticket)) || ![value.inputHash, value.resultHash, value.videoHash].every(
    (item) => item === null || hash2(item)
  ) || !(value.commitments === null || Array.isArray(value.commitments) && value.commitments.length === 4 && value.commitments.every(hash2)) || !(value.winners === null || Array.isArray(value.winners) && value.winners.length === 3 && value.winners.every((item) => integer(item) && item < 4)) || !(value.automaticStrategyMask === void 0 || integer(value.automaticStrategyMask) && value.automaticStrategyMask <= 15) || !Array.isArray(value.seats) || value.seats.length > 4 || !value.seats.every(
    (seat, index) => record(seat) && seat.seat === index && address(seat.player) && address(seat.collection) && integer(seat.nftChainId) && seat.nftChainId > 0 && decimal3(seat.tokenId)
  ))
    throw new Error("Native Arena state has an unsupported shape.");
  return value;
}
var NativeArenaSource = class {
  constructor(pool, releaseId, contract, startBlock) {
    this.pool = pool;
    this.releaseId = releaseId;
    if (!hash2(releaseId) || !address(contract.toLowerCase()) || /^0x0{40}$/i.test(contract) || startBlock < 0n)
      throw new Error("Invalid native Arena source configuration.");
    this.definition = {
      contract: contract.toLowerCase(),
      startBlock: String(startBlock),
      abiHash: manifestDigest(arenaAbi)
    };
  }
  definition;
  async read(id, options = {}) {
    const reader = await createIndexerReader(this.pool, {
      releaseId: this.releaseId
    });
    const result = await readArenaTournament(
      reader,
      this.definition,
      id,
      options
    );
    return {
      ...result,
      tournament: result.tournament ? {
        ...result.tournament,
        state: nativeTournamentState(result.tournament.state)
      } : null
    };
  }
  async credit(wallet) {
    return readArenaCredit(
      await createIndexerReader(this.pool, { releaseId: this.releaseId }),
      this.definition,
      wallet.toLowerCase()
    );
  }
  async list(wallet) {
    return readArenaTournamentIds(
      await createIndexerReader(this.pool, { releaseId: this.releaseId }),
      this.definition,
      { wallet: wallet?.toLowerCase(), limit: 30 }
    );
  }
  async work() {
    return readArenaTournamentIds(
      await createIndexerReader(this.pool, { releaseId: this.releaseId }),
      this.definition,
      { workOnly: true, limit: 100 }
    );
  }
  async browse(request) {
    return readArenaBrowse(
      await createIndexerReader(this.pool, { releaseId: this.releaseId }),
      this.definition,
      request
    );
  }
  async transaction(hash4, options = {}) {
    return readArenaTransaction(
      await createIndexerReader(this.pool, { releaseId: this.releaseId }),
      this.definition,
      hash4.toLowerCase(),
      {
        ...options,
        ...options.blockHash ? { blockHash: options.blockHash.toLowerCase() } : {}
      }
    );
  }
};

// accepted264a:apps/yunipals-market-api/src/arena/live/rollbackSource.ts
var hash3 = (value) => typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
var decimal4 = (value) => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
function arenaRollbackSourceId(url, contract, start) {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("Arena rollback requires PostgreSQL.");
  return manifestDigest({
    kind: "arena-legacy-rollback-v1",
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: parsed.pathname,
    deployment: `8453:${contract.toLowerCase()}`,
    startBlock: String(start),
    abiHash: manifestDigest(arenaAbi)
  });
}
var ArenaRollbackSource = class {
  constructor(pool, releaseId, contract, startBlock, floor, client) {
    this.pool = pool;
    this.releaseId = releaseId;
    this.contract = contract;
    this.startBlock = startBlock;
    this.floor = floor;
    this.client = client;
    if (!hash3(releaseId) || !/^0x[0-9a-f]{40}$/.test(contract) || startBlock < 0n || !decimal4(floor.block) || !hash3(floor.hash) || BigInt(floor.block) < startBlock)
      throw new Error("Invalid Arena rollback source/floor.");
    this.deployment = `8453:${contract}`;
  }
  deployment;
  async snapshot(read) {
    const db = await this.pool.connect();
    let frame2;
    let result;
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      frame2 = (await db.query(
        "SELECT cursor::text,cursor_hash,finalized_at,start_block::text,contract,indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1",
        [this.deployment]
      )).rows[0];
      if (!frame2 || frame2.halted || frame2.indexer_mode !== "legacy" || frame2.contract !== this.contract || frame2.start_block !== String(this.startBlock) || !decimal4(frame2.cursor) || !hash3(frame2.cursor_hash) || !frame2.finalized_at || Math.abs(Date.now() - frame2.finalized_at.getTime()) > 18e4 || BigInt(frame2.cursor) < BigInt(this.floor.block))
        throw new Error(
          "Arena rollback source is stale, halted or below its accepted floor."
        );
      result = await read(db, frame2);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
    if (await this.client.getChainId() !== 8453)
      throw new Error("Arena rollback source requires Base.");
    const [head, boundary, floor] = await Promise.all([
      this.client.getBlock({ blockTag: "latest" }),
      this.client.getBlock({ blockNumber: BigInt(frame2.cursor) }),
      this.client.getBlock({ blockNumber: BigInt(this.floor.block) })
    ]);
    if (!head.hash || Math.abs(Date.now() - Number(head.timestamp) * 1e3) > 12e4 || head.number < BigInt(frame2.cursor) || boundary.hash !== frame2.cursor_hash || floor.hash !== this.floor.hash || (await this.client.getBlock({ blockNumber: head.number })).hash !== head.hash)
      throw new Error("Arena rollback coverage is not currently canonical.");
    return result;
  }
  coverage(frame2) {
    return {
      releaseId: this.releaseId,
      sourceId: `arena:${this.deployment}`,
      indexedThroughBlock: frame2.cursor,
      observedThroughBlock: frame2.cursor
    };
  }
  evidence(event, frame2) {
    if (!decimal4(event.block_number) || BigInt(event.block_number) < this.startBlock || BigInt(event.block_number) > BigInt(frame2.cursor) || !hash3(event.block_hash) || !hash3(event.transaction_hash) || !Number.isSafeInteger(event.log_index) || event.log_index < 0 || !arenaAbi.some(
      (entry) => entry.type === "event" && entry.name === event.event_name
    ) || !event.args || typeof event.args !== "object" || Array.isArray(event.args))
      throw new Error("Arena rollback event evidence is incomplete.");
    return {
      id: `${this.deployment}:${event.transaction_hash}:${event.log_index}`,
      blockNumber: event.block_number,
      blockHash: event.block_hash,
      transactionHash: event.transaction_hash,
      logIndex: event.log_index
    };
  }
  async tournament(db, frame2, id) {
    const row = (await db.query(
      "SELECT state FROM yunipals_arena.tournament WHERE deployment=$1 AND id=$2",
      [this.deployment, id]
    )).rows[0];
    if (!row) return null;
    const state = nativeTournamentState(row.state);
    const events = (await db.query(
      `SELECT block_number::text,block_hash,transaction_hash,log_index,event_name,args
      FROM yunipals_arena.chain_event WHERE deployment=$1 AND args->>'id'=$2
      ORDER BY block_number,log_index LIMIT 257`,
      [this.deployment, id]
    )).rows;
    if (state.id !== id || !events.length || events.length > 256 || events[0].event_name !== "TournamentOpened" || events.filter((e) => e.event_name === "TournamentOpened").length !== 1 || events[0].args.rulesHash !== state.rulesHash || events[0].args.poolHash !== state.poolHash)
      throw new Error("Arena rollback opening/public state is incomplete.");
    const proofs = events.map((event) => this.evidence(event, frame2));
    const opened = proofs[0], last = proofs.at(-1);
    let freezeIndex = -1;
    for (let index = events.length - 1; index >= 0; index--)
      if (events[index].event_name === "InputFrozen") {
        freezeIndex = index;
        break;
      }
    const freeze = freezeIndex < 0 ? null : events[freezeIndex];
    if (state.inputHash ? !freeze || freeze.args.inputHash !== state.inputHash || canonicalJson(freeze.args.strategyCommitments) !== canonicalJson(state.commitments) : freeze !== null)
      throw new Error("Arena rollback frozen input differs from public state.");
    return {
      deployment: this.deployment,
      id,
      state,
      incarnation: manifestDigest({
        deployment: this.deployment,
        tournamentId: id,
        openedEventId: opened.id,
        openedBlockHash: opened.blockHash
      }),
      opened,
      last,
      inputFrozen: freezeIndex < 0 ? null : proofs[freezeIndex]
    };
  }
  async read(id, options = {}) {
    if (!decimal4(id) || BigInt(id) >= 2n ** 256n || options.requiredThroughBlock !== void 0 && options.requiredThroughBlock < 0n || options.expectedIncarnation !== void 0 && !hash3(options.expectedIncarnation))
      throw new Error("Invalid rollback tournament selector.");
    return this.snapshot(async (db, frame2) => {
      if (options.requiredThroughBlock !== void 0 && BigInt(frame2.cursor) < options.requiredThroughBlock)
        throw new Error(
          "Arena rollback source has not indexed the required block."
        );
      const tournament = await this.tournament(db, frame2, id);
      if (options.expectedIncarnation && tournament?.incarnation !== options.expectedIncarnation)
        throw new Error("Arena rollback tournament opening changed.");
      return { ...this.coverage(frame2), tournament };
    });
  }
  ids(wallet, work = false) {
    if (wallet && !/^0x[0-9a-f]{40}$/.test(wallet))
      throw new Error("Invalid Arena wallet.");
    return this.snapshot(async (db, frame2) => {
      const rows = (await db.query(
        `SELECT id::text FROM yunipals_arena.tournament WHERE deployment=$1
        ${work ? "AND (state->>'phase' IN('open','strategies','resolving') OR (state->>'phase'='settled' AND state->>'videoHash' IS NULL))" : ""}
        ${wallet ? "AND (state->>'islandBeneficiary'=$2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(state->'seats') seat WHERE seat->>'player'=$2))" : ""}
        ORDER BY id ${work ? "ASC LIMIT 100" : "DESC LIMIT 30"}`,
        [this.deployment, ...wallet ? [wallet] : []]
      )).rows;
      return { ...this.coverage(frame2), ids: rows.map((row) => row.id) };
    });
  }
  list(wallet) {
    return this.ids(wallet?.toLowerCase());
  }
  work() {
    return this.ids(void 0, true);
  }
  async credit(wallet) {
    wallet = wallet.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(wallet))
      throw new Error("Invalid Arena wallet.");
    return this.snapshot(async (db, frame2) => {
      const amount = (await db.query(
        "SELECT amount::text FROM yunipals_arena.credit WHERE deployment=$1 AND wallet=$2",
        [this.deployment, wallet]
      )).rows[0]?.amount ?? "0";
      if (!decimal4(amount) || BigInt(amount) >= 2n ** 256n)
        throw new Error("Invalid rollback credit.");
      const row = (await db.query(
        `SELECT e.block_number::text,e.block_hash,e.transaction_hash,e.log_index,e.event_name,e.args
        FROM yunipals_arena.chain_event e LEFT JOIN yunipals_arena.tournament t
        ON t.deployment=e.deployment AND t.id::text=e.args->>'id'
        WHERE e.deployment=$1 AND ((e.event_name='Claimed' AND e.args->>'player'=$2)
        OR (e.event_name='TournamentExpired' AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.state->'seats') seat WHERE seat->>'player'=$2))
        OR (e.event_name='PayoutsReleased' AND (t.state->>'treasury'=$2 OR t.state->>'islandBeneficiary'=$2
        OR t.state->'seats'->((t.state->'winners'->>2)::integer)->>'player'=$2)))
        ORDER BY e.block_number DESC,e.log_index DESC LIMIT 1`,
        [this.deployment, wallet]
      )).rows[0];
      if (!row && amount !== "0")
        throw new Error("Rollback credit has no event proof.");
      return {
        ...this.coverage(frame2),
        amount,
        last: row ? this.evidence(row, frame2) : null
      };
    });
  }
  /** Browsing rollback uses only the isolated, verified public endpoint. Never
   * read the operational deployment's retired tournament or credit projection. */
  async browse(request) {
    const limit = request.limit ?? 25;
    if (!["tournaments", "wallet", "island", "timeline", "rewards"].includes(
      request.kind
    ) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || request.wallet !== void 0 && !/^0x[0-9a-f]{40}$/.test(request.wallet) || [request.before, request.islandId, request.tournamentId].some(
      (v) => v != null && (!decimal4(v) || BigInt(v) >= 2n ** 256n)
    ) || request.role !== void 0 && !["any", "entrant", "host"].includes(request.role) || request.status !== void 0 && !["all", "active", "completed", "refunded"].includes(request.status) || ["wallet", "rewards"].includes(request.kind) && !request.wallet || request.kind === "island" && !request.islandId || request.kind === "timeline" && !request.tournamentId || request.role && request.role !== "any" && !request.wallet || request.cursorAnchor && (!decimal4(request.cursorAnchor.number) || !hash3(request.cursorAnchor.hash)))
      throw new Error("Invalid rollback public browse request.");
    return this.snapshot(async (db, frame2) => {
      const cursorAnchor = request.cursorAnchor ?? {
        number: frame2.cursor,
        hash: frame2.cursor_hash
      };
      if (BigInt(cursorAnchor.number) > BigInt(frame2.cursor) || (await this.client.getBlock({
        blockNumber: BigInt(cursorAnchor.number)
      })).hash !== cursorAnchor.hash)
        throw new Error("Rollback history cursor anchor changed or expired.");
      const result = {
        ...this.coverage(frame2),
        cursorAnchor,
        rows: [],
        events: [],
        totals: null,
        island: null,
        amount: "0",
        withdrawals: "0"
      };
      if (request.kind === "tournaments" || request.kind === "island") {
        const selected = (await db.query(
          `SELECT id::text FROM yunipals_arena.tournament t WHERE deployment=$1
          AND ($2::numeric IS NULL OR id<$2)
          AND ($3::text IS NULL OR ($4 IN ('any','entrant') AND EXISTS(SELECT 1 FROM jsonb_array_elements(state->'seats') s WHERE s->>'player'=$3))
            OR ($4 IN ('any','host') AND state->>'islandBeneficiary'=$3))
          AND ($5='all' OR ($5='active' AND state->>'phase' IN ('open','strategies','resolving'))
            OR ($5='completed' AND state->>'phase'='settled') OR ($5='refunded' AND state->>'phase'='expired'))
          AND ($6::text IS NULL OR state->>'islandId'=$6) ORDER BY id DESC LIMIT $7`,
          [
            this.deployment,
            request.before ?? null,
            request.wallet ?? null,
            request.role ?? "any",
            request.status ?? "all",
            request.islandId ?? null,
            limit
          ]
        )).rows;
        for (const { id } of selected) {
          const t = await this.tournament(db, frame2, id);
          if (!t) throw new Error("Rollback tournament changed in snapshot.");
          result.rows.push({
            id,
            state: t.state,
            incarnation: t.incarnation,
            inputFrozen: t.inputFrozen
          });
        }
      }
      if (request.kind === "island") {
        result.island = (await db.query(
          `SELECT count(*)::text AS hosted,
          (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL)*400000)::text AS released,
          (count(*) FILTER(WHERE state->>'phase'='settled' AND state->>'videoHash' IS NULL)*400000)::text AS pending
          FROM yunipals_arena.tournament WHERE deployment=$1 AND state->>'islandId'=$2`,
          [this.deployment, request.islandId]
        )).rows[0];
      }
      if (request.kind === "wallet") {
        result.totals = (await db.query(
          `WITH participants AS (
          SELECT state,(SELECT count(*) FROM jsonb_array_elements(state->'seats') s WHERE s->>'player'=$2) AS own,
            state->>'islandBeneficiary'=$2 AS host,state->>'treasury'=$2 AS treasury,
            state->'seats'->((state->'winners'->>2)::int)->>'player'=$2 AS winner
          FROM yunipals_arena.tournament WHERE deployment=$1)
          SELECT count(*) FILTER(WHERE own>0)::text AS entered_tournaments,coalesce(sum(own),0)::text AS entered_seats,
            count(*) FILTER(WHERE host)::text AS hosted_tournaments,count(*) FILTER(WHERE state->>'phase'='settled' AND winner)::text AS championships,
            (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL AND winner)*6000000)::text AS winnings,
            (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL AND host)*400000)::text AS hosting,
            (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL AND treasury)*1600000)::text AS operations,
            coalesce(sum(own*2000000) FILTER(WHERE state->>'phase'='expired'),0)::text AS refunds,
            coalesce(sum((CASE WHEN winner THEN 6000000 ELSE 0 END)+(CASE WHEN host THEN 400000 ELSE 0 END)+(CASE WHEN treasury THEN 1600000 ELSE 0 END))
              FILTER(WHERE state->>'phase'='settled' AND state->>'videoHash' IS NULL),0)::text AS pending FROM participants`,
          [this.deployment, request.wallet]
        )).rows[0];
        result.amount = (await db.query(
          "SELECT amount::text FROM yunipals_arena.credit WHERE deployment=$1 AND wallet=$2",
          [this.deployment, request.wallet]
        )).rows[0]?.amount ?? "0";
        result.withdrawals = (await db.query(
          `SELECT coalesce(sum((args->>'amount')::numeric),0)::text AS amount FROM yunipals_arena.chain_event
          WHERE deployment=$1 AND event_name='Claimed' AND lower(args->>'player')=$2 AND block_number<=$3`,
          [this.deployment, request.wallet, frame2.cursor]
        )).rows[0].amount;
      }
      if (request.kind === "rewards" || request.kind === "timeline") {
        if (request.kind === "timeline" && !await this.tournament(db, frame2, request.tournamentId))
          throw new Error("Rollback tournament not found.");
        const events = (await db.query(
          `SELECT e.block_number::text,e.block_hash,e.transaction_hash,e.log_index,e.event_name,e.args,t.state
          FROM yunipals_arena.chain_event e LEFT JOIN yunipals_arena.tournament t ON t.deployment=e.deployment AND t.id::text=e.args->>'id'
          WHERE e.deployment=$1 AND e.block_number<=$2 AND ($3::numeric IS NULL OR e.block_number::numeric*4294967296+e.log_index+1<$3)
          AND (${request.kind === "timeline" ? "e.args->>'id'=$4" : "e.event_name IN ('PayoutsReleased','TournamentExpired','Claimed') AND ((e.event_name='Claimed' AND lower(e.args->>'player')=$4) OR (e.event_name<>'Claimed' AND (t.state->>'islandBeneficiary'=$4 OR t.state->>'treasury'=$4 OR EXISTS(SELECT 1 FROM jsonb_array_elements(t.state->'seats') s WHERE s->>'player'=$4))))"})
          ORDER BY e.block_number ${request.kind === "timeline" ? "ASC" : "DESC"},e.log_index ${request.kind === "timeline" ? "ASC" : "DESC"} LIMIT $5`,
          [
            this.deployment,
            frame2.cursor,
            request.before ?? null,
            request.kind === "timeline" ? request.tournamentId : request.wallet,
            limit
          ]
        )).rows;
        for (const e of events) {
          this.evidence(e, frame2);
          if (e.event_name !== "Claimed") {
            const t = await this.tournament(db, frame2, String(e.args.id));
            if (!t || BigInt(e.block_number) < BigInt(t.opened.blockNumber) || e.block_number === t.opened.blockNumber && e.log_index < t.opened.logIndex)
              throw new Error(
                "Rollback history event predates its current opening."
              );
          }
          result.events.push({
            n: String(
              BigInt(e.block_number) * 4294967296n + BigInt(e.log_index) + 1n
            ),
            event_name: e.event_name,
            args: e.args,
            transaction_hash: e.transaction_hash,
            block_number: e.block_number,
            log_index: e.log_index,
            state: e.state
          });
        }
      }
      if ((await this.client.getBlock({
        blockNumber: BigInt(cursorAnchor.number)
      })).hash !== cursorAnchor.hash)
        throw new Error("Rollback history cursor changed during read.");
      return result;
    });
  }
  async transaction(transactionHash, options = {}) {
    transactionHash = transactionHash.toLowerCase();
    if (!hash3(transactionHash) || options.tournamentId !== void 0 && !decimal4(options.tournamentId) || options.blockNumber === void 0 !== (options.blockHash === void 0) || options.blockNumber !== void 0 && options.blockNumber < 0n || options.blockHash !== void 0 && !hash3(options.blockHash))
      throw new Error("Invalid rollback transaction selector.");
    return this.snapshot(async (db, frame2) => {
      const empty = {
        ...this.coverage(frame2),
        finalizedThroughBlock: null,
        events: [],
        origin: null
      };
      if (options.blockNumber !== void 0 && options.blockNumber > BigInt(frame2.cursor))
        return { ...empty, inclusion: "not_indexed" };
      const rows = (await db.query(
        `SELECT block_number::text,block_hash,transaction_hash,log_index,event_name,args
        FROM yunipals_arena.chain_event WHERE deployment=$1 AND transaction_hash=$2 ORDER BY log_index LIMIT 257`,
        [this.deployment, transactionHash]
      )).rows;
      if (rows.length > 256)
        throw new Error("Rollback transaction event limit exceeded.");
      const events = rows.map((row) => ({
        ...this.evidence(row, frame2),
        name: row.event_name,
        args: row.args
      }));
      let inclusion = null;
      if (options.blockNumber !== void 0) {
        const block = await this.client.getBlock({
          blockNumber: options.blockNumber
        });
        inclusion = block.hash === options.blockHash ? "canonical" : "changed";
        if (events.some(
          (event) => event.blockNumber !== String(options.blockNumber) || event.blockHash !== options.blockHash
        ))
          inclusion = "changed";
      }
      const tournament = options.tournamentId ? await this.tournament(db, frame2, options.tournamentId) : null;
      if (tournament && events.some(
        (event) => String(event.args.id) === options.tournamentId && (BigInt(event.blockNumber) < BigInt(tournament.opened.blockNumber) || event.blockNumber === tournament.opened.blockNumber && event.logIndex < tournament.opened.logIndex)
      ))
        throw new Error("Rollback transaction predates the current opening.");
      return {
        ...empty,
        events,
        inclusion,
        origin: tournament ? { incarnation: tournament.incarnation, opened: tournament.opened } : null
      };
    });
  }
};

// accepted264a:apps/yunipals-market-api/src/arena/live/sourceSelectionSchema.ts
import { createHash as createHash4 } from "node:crypto";
var statements = [
  `CREATE TABLE yunipals_arena.source_operational_cursor (
    deployment text PRIMARY KEY REFERENCES yunipals_arena.deployment(id),
    indexed_block bigint NOT NULL CHECK(indexed_block>=0),
    source_id text NOT NULL CHECK(source_id~'^0x[0-9a-f]{64}$'),
    observed_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE yunipals_arena.source_selection (
    deployment text PRIMARY KEY REFERENCES yunipals_arena.deployment(id),
    epoch uuid NOT NULL,kind text NOT NULL CHECK(kind IN('unified','legacy_rollback')),
    source_id text NOT NULL CHECK(source_id~'^0x[0-9a-f]{64}$'),
    accepted_block bigint NOT NULL CHECK(accepted_block>=0),
    accepted_hash text NOT NULL CHECK(accepted_hash~'^0x[0-9a-f]{64}$'),
    review_hash text NOT NULL CHECK(review_hash~'^0x[0-9a-f]{64}$'),
    switched_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE yunipals_arena.source_switch_history (
    epoch uuid PRIMARY KEY,deployment text NOT NULL REFERENCES yunipals_arena.deployment(id),
    review_hash text NOT NULL CHECK(review_hash~'^0x[0-9a-f]{64}$'),
    review jsonb NOT NULL,switched_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE FUNCTION yunipals_arena.source_switch_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $source$
    BEGIN RAISE EXCEPTION 'Arena source switch history is immutable'; END $source$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.source_switch_immutable() FROM PUBLIC`,
  `CREATE TRIGGER arena_source_switch_immutable BEFORE UPDATE OR DELETE ON yunipals_arena.source_switch_history
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.source_switch_immutable()`,
  `CREATE FUNCTION yunipals_arena.source_selection_fence() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $source$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('arena/source-selection/'||NEW.deployment));
      IF NOT EXISTS(SELECT 1 FROM yunipals_arena.deployment d WHERE d.id=NEW.deployment AND d.halted AND d.indexer_mode='unified')
        THEN RAISE EXCEPTION 'Arena source change requires halted compatible consumers'; END IF;
      IF TG_OP='UPDATE' AND (NEW.deployment<>OLD.deployment OR NEW.accepted_block<OLD.accepted_block)
        THEN RAISE EXCEPTION 'Arena source floor cannot be reset'; END IF;
      IF NOT EXISTS(SELECT 1 FROM yunipals_arena.source_switch_history h
        WHERE h.epoch=NEW.epoch AND h.deployment=NEW.deployment AND h.review_hash=NEW.review_hash
        AND h.review#>>'{target,kind}'=NEW.kind AND h.review#>>'{target,sourceId}'=NEW.source_id
        AND h.review#>>'{accepted,block}'=NEW.accepted_block::text AND h.review#>>'{accepted,hash}'=NEW.accepted_hash)
        THEN RAISE EXCEPTION 'Arena source change has no matching immutable review'; END IF;
      RETURN NEW;
    END $source$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.source_selection_fence() FROM PUBLIC`,
  `CREATE TRIGGER arena_source_selection_fence BEFORE INSERT OR UPDATE ON yunipals_arena.source_selection
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.source_selection_fence()`
];
var arenaSourceSelectionMigration = {
  version: 9,
  checksum: createHash4("sha256").update(JSON.stringify(statements)).digest("hex")
};
var watermarkSql = `ALTER TABLE yunipals_arena.source_operational_cursor
  DROP CONSTRAINT source_operational_cursor_deployment_fkey,
  ADD CONSTRAINT source_operational_cursor_deployment_fkey FOREIGN KEY(deployment)
  REFERENCES yunipals_arena.deployment(id) ON DELETE CASCADE`;
var arenaSourceWatermarkMigration = {
  version: 10,
  checksum: createHash4("sha256").update(watermarkSql).digest("hex")
};
var deleteFenceSql = `CREATE TRIGGER arena_source_selection_no_delete BEFORE DELETE ON yunipals_arena.source_selection
  FOR EACH ROW EXECUTE FUNCTION yunipals_arena.source_switch_immutable()`;
var arenaSourceDeleteFenceMigration = {
  version: 11,
  checksum: createHash4("sha256").update(deleteFenceSql).digest("hex")
};
var predecessorStatements = [
  `CREATE OR REPLACE FUNCTION yunipals_arena.source_selection_fence() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $source$
    DECLARE previous jsonb;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('arena/source-selection/'||NEW.deployment));
      IF NOT EXISTS(SELECT 1 FROM yunipals_arena.deployment d WHERE d.id=NEW.deployment AND d.halted AND d.indexer_mode='unified')
        THEN RAISE EXCEPTION 'Arena source change requires halted compatible consumers'; END IF;
      IF TG_OP='UPDATE' THEN
        IF NEW.deployment<>OLD.deployment OR NEW.accepted_block<OLD.accepted_block OR NEW.epoch=OLD.epoch
          THEN RAISE EXCEPTION 'Arena source change requires a fresh epoch and nondecreasing floor'; END IF;
        previous:=jsonb_build_object('epoch',OLD.epoch::text,'kind',OLD.kind,'source_id',OLD.source_id);
      ELSE previous:='null'::jsonb; END IF;
      IF NEW.accepted_block<COALESCE((SELECT c.indexed_block FROM yunipals_arena.source_operational_cursor c WHERE c.deployment=NEW.deployment),0)
        THEN RAISE EXCEPTION 'Arena source is below the accepted operational floor'; END IF;
      IF NOT EXISTS(SELECT 1 FROM yunipals_arena.source_switch_history h
        WHERE h.epoch=NEW.epoch AND h.deployment=NEW.deployment AND h.review_hash=NEW.review_hash
        AND h.review#>>'{target,kind}'=NEW.kind AND h.review#>>'{target,sourceId}'=NEW.source_id
        AND h.review#>>'{accepted,block}'=NEW.accepted_block::text AND h.review#>>'{accepted,hash}'=NEW.accepted_hash
        AND h.review->'previous'=previous)
        THEN RAISE EXCEPTION 'Arena source change has no matching immutable review for its current predecessor'; END IF;
      RETURN NEW;
    END $source$`,
  `CREATE FUNCTION yunipals_arena.source_watermark_fence() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $source$
    DECLARE selected text; selected_deployment text;
    BEGIN
      IF TG_OP='DELETE' THEN selected_deployment:=OLD.deployment; ELSE selected_deployment:=NEW.deployment; END IF;
      PERFORM pg_advisory_xact_lock_shared(hashtext('arena/source-selection/'||selected_deployment));
      IF TG_OP='DELETE' THEN
        IF EXISTS(SELECT 1 FROM yunipals_arena.deployment d WHERE d.id=OLD.deployment)
          THEN RAISE EXCEPTION 'Arena operational floor cannot be deleted'; END IF;
        RETURN OLD;
      END IF;
      IF TG_OP='UPDATE' AND (NEW.deployment<>OLD.deployment OR NEW.indexed_block<OLD.indexed_block)
        THEN RAISE EXCEPTION 'Arena operational floor cannot decrease'; END IF;
      SELECT s.source_id INTO selected FROM yunipals_arena.source_selection s WHERE s.deployment=NEW.deployment;
      IF selected IS NOT NULL AND NEW.source_id<>selected
        THEN RAISE EXCEPTION 'Arena watermark source epoch changed'; END IF;
      RETURN NEW;
    END $source$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.source_watermark_fence() FROM PUBLIC`,
  `CREATE TRIGGER arena_source_watermark_fence BEFORE INSERT OR UPDATE OR DELETE ON yunipals_arena.source_operational_cursor
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.source_watermark_fence()`
];
var arenaSourcePredecessorMigration = {
  version: 12,
  checksum: createHash4("sha256").update(JSON.stringify(predecessorStatements)).digest("hex")
};

// accepted264a:apps/yunipals-market-api/src/arena/live/selectedSourceRuntime.ts
async function selectedArenaRuntimeSource(options) {
  const { pool, sourcePool, native, deployment, base: base2 } = options;
  const selected = await selectedArenaSource(pool, deployment.id);
  let binding;
  if (selected) {
    if (native.mode !== "unified" || selected.kind !== native.sourceKind || selected.source_id !== native.releaseId)
      throw new Error(
        "Arena runtime does not match its selected source epoch."
      );
    binding = {
      epoch: selected.epoch,
      kind: selected.kind,
      sourceId: selected.source_id
    };
  }
  if (native.mode === "unified" && native.sourceKind === "legacy_rollback" && !binding)
    throw new Error(
      "Arena rollback requires an explicitly reviewed source switch."
    );
  for (const migration of [
    arenaSourceSelectionMigration,
    arenaSourceWatermarkMigration,
    arenaSourceDeleteFenceMigration,
    arenaSourcePredecessorMigration
  ]) {
    const marker = (await pool.query(
      "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=$1",
      [migration.version]
    )).rows[0];
    if (marker?.checksum !== migration.checksum)
      throw new Error(
        "Arena source selection schema does not match this runtime."
      );
  }
  if (native.mode !== "unified") return { nativeSource: void 0, binding };
  if (!sourcePool)
    throw new Error("Native Arena requires its read-only source pool.");
  if (native.sourceKind === "unified")
    return {
      nativeSource: new NativeArenaSource(
        sourcePool,
        native.releaseId,
        deployment.contract,
        deployment.startBlock
      ),
      binding
    };
  const floor = (await pool.query(
    "SELECT accepted_block::text AS block,accepted_hash AS hash FROM yunipals_arena.source_selection WHERE deployment=$1",
    [deployment.id]
  )).rows[0];
  if (!floor)
    throw new Error("Arena rollback requires its reviewed source floor.");
  if (arenaRollbackSourceId(
    native.databaseUrl,
    deployment.contract,
    deployment.startBlock
  ) !== native.releaseId)
    throw new Error(
      "Arena rollback source identity differs from its endpoint/configuration."
    );
  const [operational, source] = await Promise.all([
    pool.query(
      "SELECT current_database() AS db,inet_server_addr()::text AS host,inet_server_port() AS port"
    ),
    sourcePool.query(
      "SELECT current_database() AS db,inet_server_addr()::text AS host,inet_server_port() AS port"
    )
  ]);
  if (JSON.stringify(operational.rows[0]) === JSON.stringify(source.rows[0]))
    throw new Error(
      "Arena rollback requires an isolated public projection database."
    );
  return {
    nativeSource: new ArenaRollbackSource(
      sourcePool,
      native.releaseId,
      deployment.contract.toLowerCase(),
      deployment.startBlock,
      floor,
      base2
    ),
    binding
  };
}

// accepted264a:apps/yunipals-market-api/src/arena/live/nativeDisclosure.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var NativeArenaDisclosure = class {
  constructor(service, verify) {
    this.service = service;
    this.verify = verify;
    if (!service.nativeSource)
      throw new Error("Native disclosure requires the selected Ponder source.");
  }
  async tick(limit = 8) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32)
      throw new Error("Invalid native disclosure batch size.");
    await this.service.ready();
    const lease = randomUUID2();
    const rows = await transaction(this.service.pool, async (db) => {
      await this.service.assertSourceSelection(db);
      const selected = (await db.query(
        `SELECT tournament_id::text AS id,incarnation FROM yunipals_arena.frozen_input
        WHERE deployment=$1 AND native_check_at<=now()
        ORDER BY native_check_at,tournament_id,incarnation LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [this.service.deployment, limit]
      )).rows;
      for (const row of selected)
        await db.query(
          `UPDATE yunipals_arena.frozen_input SET native_check_at=now()+interval '2 minutes',native_check_lease=$4
        WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3`,
          [this.service.deployment, row.id, row.incarnation, lease]
        );
      return selected;
    });
    const result = { checked: 0, revealed: 0, waiting: 0, unavailable: 0 };
    for (const id of new Set(rows.map((row) => row.id))) {
      let delay = 30;
      try {
        const revealed = await this.service.reconcileInputFrozen(
          id,
          this.verify
        );
        if (revealed) {
          result.revealed++;
          delay = 60;
        } else {
          result.waiting++;
          delay = 5;
        }
      } catch (error) {
        if (error instanceof ArenaRequestError && error.status === 404) {
          result.waiting++;
          delay = 600;
        } else result.unavailable++;
      }
      result.checked++;
      await this.service.pool.query(
        `UPDATE yunipals_arena.frozen_input SET native_check_at=now()+$4*interval '1 second',native_check_lease=NULL
        WHERE deployment=$1 AND tournament_id=$2 AND native_check_lease=$3`,
        [this.service.deployment, id, lease, delay]
      );
    }
    return result;
  }
};

// accepted264a:apps/yunipals-market-api/src/arena/live/nativeAction.ts
var zeroHash = `0x${"0".repeat(64)}`;
var zeroAddress = `0x${"0".repeat(40)}`;
var phases = {
  open: 1,
  strategies: 2,
  resolving: 3,
  settled: 4,
  expired: 5
};
async function verifyNativeArenaAction(client, observed) {
  if (await client.getChainId() !== 8453)
    throw new Error("Native Arena action requires Base.");
  const t = observed.tournament, state = t.state;
  const head = await client.getBlock({ blockTag: "latest" });
  if (!head.hash || Math.abs(Number(head.timestamp) * 1e3 - Date.now()) > 12e4 || head.number < BigInt(t.last.blockNumber))
    throw new Error("Native Arena action head is unavailable.");
  const anchors = /* @__PURE__ */ new Map();
  for (const event of [t.opened, t.last, t.inputFrozen].filter(
    (event2) => event2 !== null
  )) {
    const prior = anchors.get(event.blockNumber);
    if (prior && prior !== event.blockHash)
      throw new Error("Native Arena event anchors disagree.");
    anchors.set(event.blockNumber, event.blockHash);
  }
  await Promise.all(
    [...anchors].map(async ([number, hash4]) => {
      if ((await client.getBlock({ blockNumber: BigInt(number) })).hash?.toLowerCase() !== hash4)
        throw new Error("Native Arena action event is no longer canonical.");
    })
  );
  const contract = t.deployment.slice(5);
  const [live, mask] = await Promise.all([
    client.readContract({
      address: contract,
      abi: arenaAbi,
      functionName: "tournament",
      args: [BigInt(t.id)],
      blockNumber: head.number
    }),
    client.readContract({
      address: contract,
      abi: arenaAbi,
      functionName: "automaticStrategyMask",
      args: [BigInt(t.id)],
      blockNumber: head.number
    })
  ]);
  if (live.phase !== phases[state.phase] || live.count !== state.seats.length || live.deadline !== BigInt(state.deadline) || live.inputHash.toLowerCase() !== (state.inputHash ?? zeroHash) || live.resultHash.toLowerCase() !== (state.resultHash ?? zeroHash) || mask !== (state.automaticStrategyMask ?? 0) || live.requestId !== BigInt(state.requestId ?? "0") || live.randomnessReceived !== (state.randomWord !== null) || live.randomWord !== BigInt(state.randomWord ?? "0") || String(live.islandId) !== (state.islandId ?? "0") || live.islandBeneficiary.toLowerCase() !== (state.islandBeneficiary ?? zeroAddress) || live.treasuryBeneficiary.toLowerCase() !== (state.treasury ?? zeroAddress) || state.winners !== null && (live.semifinalOneWinner !== state.winners[0] || live.semifinalTwoWinner !== state.winners[1] || live.champion !== state.winners[2]))
    throw new Error("Native Arena action state changed.");
  if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash)
    throw new Error("Native Arena action head changed during verification.");
}

// accepted264a:apps/yunipals-market-api/src/arena/live/nativeDisclosureWorker.ts
async function run() {
  const native = arenaNativeConfiguration();
  if (native.mode !== "unified")
    throw new Error("Explicit unified mode is required.");
  const config = arenaConfig();
  const common = {
    connectionTimeoutMillis: 2e3,
    statement_timeout: 5e3,
    lock_timeout: 2e3,
    idle_in_transaction_session_timeout: 15e3
  };
  const sourcePool = new pg2.Pool({
    ...common,
    connectionString: native.databaseUrl,
    max: 3,
    application_name: "arena_native_disclosure_source",
    options: "-c default_transaction_read_only=on"
  });
  const pool = new pg2.Pool({
    ...common,
    connectionString: config.databaseUrl,
    max: 4,
    application_name: "arena_native_disclosure"
  });
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const base2 = arenaRpcClients().get(8453);
    const { nativeSource, binding } = await selectedArenaRuntimeSource({
      pool,
      sourcePool,
      native,
      deployment: config.deployment,
      base: base2
    });
    if (!nativeSource) throw new Error("Native disclosure source is unavailable.");
    const service = new ArenaIntake(
      pool,
      config.deployment.id,
      config.deployment.contract,
      config.origin,
      new StrategyCipher(config.encryptionKey),
      {
        message: (input) => base2.verifyMessage(input),
        strategy: (input) => base2.verifyTypedData(input)
      },
      nativeSource,
      binding
    );
    await service.ready();
    const work = new NativeArenaDisclosure(
      service,
      (observed) => verifyNativeArenaAction(base2, observed)
    );
    while (!stopped) {
      try {
        const result = await work.tick();
        if (result.checked)
          console.log(
            JSON.stringify({
              event: "arena_native_disclosure_checked",
              ...result
            })
          );
      } catch {
        console.error(
          "Native Arena disclosure unavailable; private inputs and scheduling leases retained."
        );
      }
      if (!stopped) await setTimeout(2e3);
    }
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await Promise.all([pool.end(), sourcePool.end()]);
  }
}
try {
  await run();
} catch {
  console.error(
    "Native Arena disclosure could not start; check explicit source selection, operational adoption and grants."
  );
  process.exitCode = 1;
}
//# sourceMappingURL=arena-native-disclosure.mjs.map
