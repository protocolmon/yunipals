/** Fresh Base Sepolia challenge: 11 actual AI edits/grades and winner-driven settlement. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { Hono } from "hono";
import {
  encodeDeployData,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  keccak256,
  parseAbi,
  parseEther,
  parseEventLogs,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  portalCollectionAbi,
  portalRegistryAbi,
  portalGradingAbi,
  portalCompetitionAbi
} from "@protopals/yunipals-market-core/portalAbi";
import {
  portalModels,
  portalModelPolicyHash,
  portalSpellCommitment,
  portalSpellSigningData
} from "@protopals/yunipals-market-core/portals";
import { PortalAssets, portalAssetHash } from "../lib/portals/assets.js";
import { PortalChain } from "../lib/portals/chain.js";
import { PortalLedger } from "../lib/portals/ledger.js";
import { PortalLedgerStore } from "../lib/portals/ledger-store.js";
import { OpenAIPortalAI } from "../lib/portals/provider.js";
import { registerPortalRoutes } from "../lib/portals/routes.js";
import { PortalStore } from "../lib/portals/store.js";
import { PortalWorker } from "../lib/portals/worker.js";
import { rainbowPortalOdds } from "../lib/portals/prepare.js";
import {
  PortalRehearsal,
  readRehearsalEnv,
  rehearsalJson,
  writeRehearsalJson,
  type RehearsalState
} from "../lib/portals/rehearsal.js";

type Artifact = { abi: Abi; bytecode: { object: Hex } };
type Art = { variantId: number; uri: string; hash: Hex };
type Deployment = {
  packs: Address;
  cards: Address;
  fixture: Address;
  usdc: Address;
  rules: Address;
  collection: Address;
  registry: Address;
  grading: Address;
  wrapper: Address;
  competition: Address;
};
const cardAbi = parseAbi([
  "function nextTokenId() view returns(uint256)",
  "function setGradingRegistry(address)",
  "function ownerOf(uint256) view returns(address)"
]);
const fixtureAbi = parseAbi(["function create(address,address,uint32,uint32)"]);
const mintAbi = parseAbi(["function mint(address,uint256)"]);
const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const testRules = keccak256(
  toHex(
    "YunipalsCompetitionTestV2:11:500000:sum4:earlier-entry:50,30,20:submitter:sequential-themes"
  )
);
let step = "configuration";

async function main() {
  process.umask(0o077);
  assert(process.env.PORTALS_REHEARSAL_ENV_FILE);
  const env = {
    ...(await readRehearsalEnv(process.env.PORTALS_REHEARSAL_ENV_FILE)),
    ...process.env
  };
  for (const name of [
    "PORTALS_REHEARSAL_AI_ENV_FILE",
    "PORTALS_REHEARSAL_GRADER_ENV_FILE",
    "PORTALS_REHEARSAL_DATABASE_ENV_FILE"
  ])
    if (env[name]) Object.assign(env, await readRehearsalEnv(env[name]!));
  const required = (key: string) => {
    assert(env[key], `Missing ${key}`);
    return env[key]!;
  };
  const account = (key: string) => privateKeyToAccount(required(key) as Hex);
  const deployer = account("PORTALS_REHEARSAL_DEPLOYER_PRIVATE_KEY");
  const player = account("PORTALS_REHEARSAL_PLAYER_PRIVATE_KEY");
  const buyer = account("PORTALS_REHEARSAL_BUYER_PRIVATE_KEY");
  const grader = account("PORTALS_GRADER_PRIVATE_KEY");
  const signers = [player, buyer, deployer];
  const wallets = {
    deployer: deployer.address,
    player: player.address,
    buyer: buyer.address,
    grader: grader.address
  };
  const directory = required("PORTALS_ELEVEN_DIRECTORY");
  const previous: RehearsalState = JSON.parse(
    await readFile(
      join(required("PORTALS_REHEARSAL_DIRECTORY"), "state.json"),
      "utf8"
    )
  );
  const competitionRun: RehearsalState = JSON.parse(
    await readFile(
      join(required("PORTALS_COMPETITION_REHEARSAL_DIRECTORY"), "state.json"),
      "utf8"
    )
  );
  assert.equal(previous.chainId, 84532);
  assert.deepEqual(previous.wallets, wallets);
  assert.deepEqual(competitionRun.wallets, wallets);
  let state: RehearsalState;
  try {
    state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
    assert.deepEqual(state.wallets, wallets);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
    state = {
      chainId: 84532,
      wallets,
      artifactHashes: {},
      transactions: {},
      observations: {}
    };
  }
  const run = new PortalRehearsal(
    required("PORTALS_RPC_URL"),
    directory,
    state,
    parseEther("0.0015")
  );
  await run.verifyNetwork();
  const client = run.client;
  const old = previous.observations.deployment as Deployment;
  const balances = await Promise.all(
    Object.entries(wallets).map(async ([name, address]) => [
      name,
      formatEther(await client.getBalance({ address }))
    ])
  );
  console.log(
    rehearsalJson({
      chainId: 84532,
      batchSize: 11,
      liveAI: true,
      balances,
      execute: process.argv.includes("--execute")
    })
  );
  if (!process.argv.includes("--execute")) return;
  if (state.observations.completed) {
    console.log(
      "Existing eleven-card rehearsal already completed; use its saved verification."
    );
    return;
  }
  required("OPENAI_API_KEY");
  const inputs = required("PORTALS_ELEVEN_INPUT_DIRECTORY");
  const promptsBytes = await readFile(join(inputs, "spells.json"));
  await run.verifyArtifact("spells", promptsBytes);
  const spells = JSON.parse(promptsBytes.toString()) as {
    title: string;
    spell: string;
  }[];
  assert.equal(spells.length, 11);
  assert(spells.every((s) => s.title && s.spell.length >= 60));
  const artifacts = new Map<string, Artifact>();
  async function artifact(name: string) {
    if (artifacts.has(name)) return artifacts.get(name)!;
    const path = ["PortalGradingCompetition", "PortalGrading"].includes(name)
      ? join(inputs, "artifacts", `${name}.json`)
      : join(
          required("PORTALS_REHEARSAL_ARTIFACT_DIRECTORY"),
          `${name}.sol`,
          `${name}.json`
        );
    const bytes = await readFile(path);
    await run.verifyArtifact(name, bytes);
    const result = JSON.parse(bytes.toString()) as Artifact;
    artifacts.set(name, result);
    return result;
  }
  async function call(
    label: string,
    to: Address,
    abi: Abi,
    fn: string,
    args: readonly unknown[] = [],
    signer: LocalAccount = deployer,
    value = 0n
  ) {
    step = label;
    return run.transaction(
      label,
      signer,
      encodeFunctionData({ abi, functionName: fn, args }),
      to,
      value
    );
  }
  async function proxy(
    name: string,
    implementation: Address,
    abi: Abi,
    args: readonly unknown[]
  ) {
    step = `proxy-${name}`;
    const compiled = await artifact("ERC1967Proxy");
    const receipt = await run.transaction(
      `proxy-${name}`,
      deployer,
      encodeDeployData({
        abi: compiled.abi,
        bytecode: compiled.bytecode.object,
        args: [
          implementation,
          encodeFunctionData({ abi, functionName: "initialize", args })
        ]
      })
    );
    assert(receipt.contractAddress);
    return receipt.contractAddress;
  }
  async function implementation(name: string, proxyAddress: Address) {
    step = `verify-${name}`;
    const tx =
      name === "PortalGrading"
        ? competitionRun.transactions["deploy-PortalGrading"]
        : previous.transactions[`deploy-${name}`];
    assert(tx?.contractAddress, `Missing verified ${name} implementation`);
    const value = await client.getStorageAt({
      address: proxyAddress,
      slot: implementationSlot
    });
    assert.equal(
      value?.slice(-40).toLowerCase(),
      tx.contractAddress.slice(2).toLowerCase(),
      "Previous test implementation changed"
    );
    const receipt = await client.getTransactionReceipt({ hash: tx.hash });
    assert.equal(receipt.status, "success");
    assert.equal(receipt.blockHash, tx.blockHash);
    return tx.contractAddress;
  }
  const origin = "https://portals-eleven-rehearsal.invalid";
  const references = JSON.parse(
    await readFile(required("PORTALS_REHEARSAL_VARIANTS_FILE"), "utf8")
  ) as Art[];
  const assets = new PortalAssets(join(directory, "assets"), origin, [
    new URL(origin).hostname,
    ...new Set(references.map((r) => new URL(r.uri).hostname))
  ]);
  const rainbow = await assets.put(
    await readFile(required("PORTALS_REHEARSAL_RAINBOW_FILE")),
    "png"
  );
  const rubric = await assets.putJson({
    policy: portalModels,
    policyHash: portalModelPolicyHash(),
    testOnly: true,
    batchSize: 11
  });
  // Reuse verified implementation code and the isolated mint fixture, with fresh proxy state.
  const cards = await proxy(
    "YunipalMonsters",
    await implementation("YunipalMonsters", old.cards),
    (await artifact("YunipalMonsters")).abi,
    [deployer.address, old.packs]
  );
  const collection = await proxy(
    "PortalCollection",
    await implementation("PortalCollection", old.collection),
    portalCollectionAbi,
    [deployer.address, old.wrapper, 3, old.rules]
  );
  const registry = await proxy(
    "PortalRegistry",
    await implementation("PortalRegistry", old.registry),
    portalRegistryAbi,
    [deployer.address, collection, old.wrapper, 3]
  );
  // The historical rules helper predates catalog validation delegation. Initialize
  // with its matching release, then exercise the same competition upgrade path.
  const gradingArtifact = await artifact("PortalGrading");
  const currentGrading = await run.transaction(
    "deploy-themed-grading",
    deployer,
    encodeDeployData({
      abi: gradingArtifact.abi,
      bytecode: gradingArtifact.bytecode.object
    })
  );
  assert(currentGrading.contractAddress);
  const gradingImplementation = currentGrading.contractAddress;
  const legacyGrading = previous.transactions["deploy-PortalGrading"];
  assert(legacyGrading.contractAddress);
  const legacyReceipt = await client.getTransactionReceipt({
    hash: legacyGrading.hash
  });
  assert.equal(legacyReceipt.status, "success");
  assert.equal(legacyReceipt.blockHash, legacyGrading.blockHash);
  const grading = await proxy(
    "PortalGrading",
    legacyGrading.contractAddress,
    portalGradingAbi,
    [
      deployer.address,
      cards,
      registry,
      old.usdc,
      1n,
      `${origin}/v1/portals/cards/`
    ]
  );
  await call("upgrade-grading", grading, portalGradingAbi, "upgradeToAndCall", [
    gradingImplementation,
    "0x"
  ]);
  const poolArtifact = await artifact("PortalGradingCompetition");
  const poolReceipt = await run.transaction(
    "deploy-eleven-pool",
    deployer,
    encodeDeployData({
      abi: poolArtifact.abi,
      bytecode: poolArtifact.bytecode.object
    })
  );
  assert(poolReceipt.contractAddress);
  const pool = await proxy(
    "PortalGradingCompetition",
    poolReceipt.contractAddress,
    portalCompetitionAbi,
    [deployer.address, grading, old.usdc]
  );
  const deployment = {
    ...old,
    cards,
    collection,
    registry,
    grading,
    competition: pool
  };
  await run.observe("deployment", deployment);
  assert.equal(
    await client.readContract({
      address: pool,
      abi: portalCompetitionAbi,
      functionName: "BATCH_SIZE"
    }),
    11n
  );
  assert.equal(
    await client.readContract({
      address: pool,
      abi: portalCompetitionAbi,
      functionName: "RULES_HASH"
    }),
    testRules
  );
  const oldPool = competitionRun.observations.competition as Address;
  assert.equal(
    await client.readContract({
      address: oldPool,
      abi: portalCompetitionAbi,
      functionName: "BATCH_SIZE"
    }),
    111n
  );
  await call(
    "bind-claims",
    collection,
    portalCollectionAbi,
    "bindClaimController",
    [grading]
  );
  await call("link-card-grading", cards, cardAbi, "setGradingRegistry", [
    grading
  ]);
  await call("authorize-grader", grading, portalGradingAbi, "grantRole", [
    keccak256(toHex("GRADER_ROLE")),
    grader.address
  ]);
  await call("configure-rubric", grading, portalGradingAbi, "configureRubric", [
    keccak256(toHex(portalModels.rubric)),
    portalModelPolicyHash(),
    20,
    rubric.uri
  ]);
  await call(
    "configure-rainbow",
    collection,
    portalCollectionAbi,
    "configureKind",
    [
      0n,
      {
        name: "Rainbow Portal",
        imageURI: rainbow.uri,
        artworkHash: rainbow.hash,
        cap: 1000,
        odds: rainbowPortalOdds
      }
    ]
  );
  const aiRecipient = required("PORTALS_AI_RECIPIENT") as Address;
  await call("configure-fees", grading, portalGradingAbi, "setPaymentPolicy", [
    1n,
    245000n,
    245000n,
    aiRecipient
  ]);
  await call(
    "bind-competition",
    grading,
    portalGradingAbi,
    "configureCompetition",
    [pool]
  );
  for (const [name, signer, target] of [
    ["player", player, "0.00008"],
    ["buyer", buyer, "0.00008"],
    ["grader", grader, "0.00013"]
  ] as const) {
    const label = `fund-${name}`;
    if (!state.observations[label]) {
      const current = await client.getBalance({ address: signer.address });
      await run.observe(
        label,
        (current < parseEther(target)
          ? parseEther(target) - current
          : 0n
        ).toString()
      );
    }
    const amount = BigInt(String(state.observations[label]));
    if (amount)
      await run.transaction(label, deployer, "0x", signer.address, amount);
  }
  const balance = (address: Address) =>
    client.readContract({
      address: old.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address]
    });
  if (!state.observations.initialAIBalance)
    await run.observe(
      "initialAIBalance",
      (await balance(aiRecipient)).toString()
    );
  for (const signer of signers) {
    await call(`currency-${signer.address}`, old.usdc, mintAbi, "mint", [
      signer.address,
      20_000_000n
    ]);
    await call(
      `approve-${signer.address}`,
      old.usdc,
      erc20Abi,
      "approve",
      [grading, 20_000_000n],
      signer
    );
  }
  async function randomness(
    label: string,
    address: Address,
    abi: Abi,
    fn: string,
    args: (value: bigint) => readonly unknown[]
  ) {
    if (!state.observations[`${label}-limit`]) {
      const quote = await client.readContract({
        address,
        abi: portalCollectionAbi,
        functionName: "quoteRandomness",
        args: [await client.getGasPrice()]
      });
      await run.observe(`${label}-limit`, ((quote * 150n) / 100n).toString());
    }
    const maximum = BigInt(String(state.observations[`${label}-limit`]));
    const receipt = await call(
      label,
      address,
      abi,
      fn,
      args(maximum),
      deployer,
      maximum
    );
    const event = parseEventLogs({
      abi: portalCollectionAbi,
      logs: receipt.logs,
      eventName: "RandomnessRequested"
    })[0];
    assert(event);
    for (let attempt = 0; attempt < 450; attempt++) {
      if (
        (
          await client.readContract({
            address,
            abi: portalCollectionAbi,
            functionName: "randomRequests",
            args: [event.args.requestId]
          })
        )[2]
      )
        return event.args.requestId;
      if (attempt % 15 === 0)
        console.log(
          rehearsalJson({
            step: "waiting-real-vrf",
            request: event.args.requestId
          })
        );
      await delay(2000);
    }
    throw new Error("VRF is pending; resume the original request");
  }
  const mint = await randomness(
    "mint-portal",
    collection,
    portalCollectionAbi,
    "mintBatch",
    (maximum) => [1n, [deployer.address], maximum]
  );
  await call("reveal-portal", collection, portalCollectionAbi, "finishMint", [
    mint,
    32
  ]);
  const portalId = 1n;
  const gates = await client.readContract({
    address: collection,
    abi: portalCollectionAbi,
    functionName: "gates",
    args: [portalId]
  });
  const variant = gates.typeGate * 24 + gates.colorGate * 4 + 3;
  const sequence = gates.originalOnly ? 0 : gates.sequenceStart;
  const original = references.find((r) => r.variantId === variant);
  assert(original);
  await assets.input(original.uri, original.hash);
  await call(
    "register-source-art",
    grading,
    portalGradingAbi,
    "registerBaseArt",
    [[variant], [{ uri: original.uri, hash: original.hash }]]
  );
  await run.observe("source", { gates, variant, sequence, original });
  const cardIds: bigint[] = [];
  for (let index = 0; index < 11; index++) {
    const label = `card-${index + 1}`;
    if (!state.observations[label]) {
      if (!state.observations[`${label}-original`])
        await run.observe(
          `${label}-original`,
          (
            await client.readContract({
              address: cards,
              abi: cardAbi,
              functionName: "nextTokenId"
            })
          ).toString()
        );
      await call(`mint-${label}`, old.fixture, fixtureAbi, "create", [
        cards,
        signers[index % 3].address,
        variant,
        sequence
      ]);
      await run.observe(
        label,
        (
          BigInt(String(state.observations[`${label}-original`])) +
          (sequence ? 1n : 0n)
        ).toString()
      );
    }
    const id = BigInt(String(state.observations[label]));
    cardIds.push(id);
    assert(
      await client.readContract({
        address: grading,
        abi: portalGradingAbi,
        functionName: "matches",
        args: [portalId, id]
      })
    );
  }
  const chain = new PortalChain(client as PublicClient, {
    chainId: 84532,
    cards,
    collection,
    registry,
    grading,
    usdc: old.usdc
  });
  const db = new pg.Pool({
    connectionString: required("PORTALS_DATABASE_URL"),
    max: 3
  });
  const store = new PortalStore(db, `84532:${grading.toLowerCase()}`);
  const ledgerStore = new PortalLedgerStore(
    db,
    `84532:${collection.toLowerCase()}:${grading.toLowerCase()}`
  );
  await store.migrate();
  await ledgerStore.migrate();
  const start = BigInt(state.transactions["proxy-PortalGrading"].block!);
  const ledger = new PortalLedger(chain, ledgerStore, start, 2n, 200n);
  const app = new Hono();
  registerPortalRoutes(app, {
    enabled: () => true,
    runtime: async () => ({
      chain,
      store,
      assets,
      ledger: ledgerStore,
      close: async () => {}
    })
  });
  const usagePath = join(directory, "provider-usage.json");
  let usage: Record<string, unknown>[] = [];
  try {
    usage = JSON.parse(await readFile(usagePath, "utf8"));
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
  }
  const trackedFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (response.ok) {
      const data = (await response.clone().json()) as {
        model?: string;
        usage?: unknown;
        id?: string;
      };
      usage.push({
        step,
        endpoint: String(input).split("/v1/")[1],
        model: data.model ?? portalModels.image,
        usage: data.usage,
        responseId: data.id,
        timestamp: new Date().toISOString()
      });
      await writeRehearsalJson(usagePath, usage);
    }
    return response;
  };
  const ai = new OpenAIPortalAI(
    required("OPENAI_API_KEY"),
    portalModels,
    trackedFetch
  );
  const worker = new PortalWorker(
    chain,
    store,
    assets,
    ai,
    portalModels,
    start,
    2n,
    async (id, result) =>
      (
        await call(
          `grade-${id}`,
          grading,
          portalGradingAbi,
          "complete",
          [id, result],
          grader
        )
      ).transactionHash,
    200n
  );
  async function catchUp() {
    const target = (await client.getBlockNumber()) - 2n;
    for (let pass = 0; pass < 500; pass++) {
      await worker.ingest();
      await ledger.tick();
      const jobCursor = await store.cursor();
      const ledgerCursor = await ledgerStore.cursor();
      if (
        jobCursor &&
        jobCursor.block >= target &&
        ledgerCursor &&
        BigInt(ledgerCursor.block) >= target
      )
        return;
    }
    throw new Error("Indexer catch-up exceeded bound");
  }
  try {
    // Admit all eleven during real portal windows; image processing can finish after closing.
    for (let index = 0; index < 11; index++) {
      const label = `admit-${index + 1}`;
      if (state.transactions[label]) {
        const saved = state.transactions[label];
        await run.transaction(label, signers[index % 3], saved.data, grading);
        continue;
      }
      let active = await chain.active();
      if (
        !active.portal ||
        !active.open ||
        active.round.endsAt < (await client.getBlock()).timestamp + 45n
      ) {
        const rotation = await randomness(
          `rotate-${index + 1}`,
          registry,
          portalRegistryAbi,
          "requestRotation",
          (maximum) => [maximum]
        );
        void rotation;
        while (
          (
            await client.readContract({
              address: registry,
              abi: portalRegistryAbi,
              functionName: "activePortal"
            })
          )[0].endsAt > (await client.getBlock()).timestamp
        )
          await delay(2000);
        await call(
          `activate-${index + 1}`,
          registry,
          portalRegistryAbi,
          "activateNext"
        );
        active = await chain.active();
      }
      const signer = signers[index % 3];
      const quote = await chain.quote(cardIds[index], signer.address);
      assert(quote.portal && quote.competition?.batchSize === 11n);
      const salt = toHex(randomBytes(32));
      const input = {
        chainId: 84532,
        grading,
        submitter: signer.address,
        tokenId: cardIds[index],
        artVersion: quote.artVersion,
        nonce: quote.nonce,
        spell: spells[index].spell,
        salt
      };
      const expiresAt = (await client.getBlock()).timestamp + 900n;
      assert(signer.signTypedData);
      const signature = await signer.signTypedData(
        portalSpellSigningData(input, expiresAt)
      );
      const upload = await app.request("/v1/portals/spells", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rehearsalJson({
          ...input,
          chainId: undefined,
          grading: undefined,
          expiresAt,
          signature
        })
      });
      assert.equal(upload.status, 200);
      const admission = {
        tokenId: cardIds[index],
        portalId,
        roundId: quote.round.id,
        paymentVersion: quote.portal.payment.version,
        artVersion: quote.artVersion,
        rubricId: quote.rubricId,
        maximumFee: 990000n,
        inputHash: quote.input.hash,
        spellCommitment: portalSpellCommitment(input),
        nonce: quote.nonce
      };
      await run.observe(label, {
        ...input,
        commitment: admission.spellCommitment,
        requestId: BigInt(index + 1)
      });
      const receipt = await call(
        label,
        grading,
        portalGradingAbi,
        "admitCompetition",
        [admission, pool, quote.competition.admissionHash],
        signer
      );
      const event = parseEventLogs({
        abi: portalGradingAbi,
        logs: receipt.logs,
        eventName: "GradingRequested"
      })[0];
      assert(event);
      assert.equal(event.args.requestId, BigInt(index + 1));
      await run.observe(label, {
        ...input,
        commitment: admission.spellCommitment,
        requestId: event.args.requestId
      });
    }
    if (!state.transactions["winner-resolve"])
      assert.equal(await balance(pool), 5_500_000n);
    assert.equal(
      await client.readContract({
        address: grading,
        abi: portalGradingAbi,
        functionName: "claimable",
        args: [portalId]
      }),
      2_695_000n
    );
    assert.equal(
      (await balance(aiRecipient)) -
        BigInt(String(state.observations.initialAIBalance)),
      2_695_000n
    );
    if (!state.observations.prematureSettlementRejected) {
      await assert.rejects(
        client.simulateContract({
          address: pool,
          abi: portalCompetitionAbi,
          functionName: "settle",
          args: [1n],
          account: player.address
        })
      );
      await run.observe("prematureSettlementRejected", true);
    }
    if (process.argv.includes("--prepare-only")) {
      console.log(
        "Eleven paid real spell requests prepared; AI phase pending."
      );
      return;
    }
    await delay(4000);
    await catchUp();
    const results: Record<string, unknown>[] = [];
    for (let index = 0; index < 11; index++) {
      const id = BigInt(index + 1);
      const prior = await chain.request(id);
      const published =
        prior.completed &&
        (await store.isPublishedArtifact(
          (await chain.result(id)).artwork.hash.slice(2)
        ));
      if (!published) {
        step = `live-ai-${id}`;
        console.log(rehearsalJson({ step, title: spells[index].title }));
        const job = await store.claim(portalModelPolicyHash());
        assert(
          job && job.requestId === id.toString(),
          "Expected durable AI job is leased; wait for its lease before resume"
        );
        const heartbeat = setInterval(() => {
          void store.heartbeat(job).catch(() => {});
        }, 60000);
        try {
          for (let retry = 0; ; retry++) {
            try {
              await worker.process(job);
              break;
            } catch (error) {
              if (retry >= 2) throw error;
              console.log(
                rehearsalJson({
                  step: "retry-durable-job",
                  requestId: id,
                  attempt: retry + 1
                })
              );
              await delay(5000);
            }
          }
        } catch (error) {
          await store.retry(
            job,
            "Rehearsal interrupted; resume durable checkpoints"
          );
          throw error;
        } finally {
          clearInterval(heartbeat);
        }
      }
      const result = await chain.result(id);
      assert(
        result.artwork.hash !== original.hash,
        "AI output must differ from source"
      );
      const image = await assets.input(result.artwork.uri, result.artwork.hash);
      assert(
        image.length > 10000 &&
          Buffer.from(image).subarray(1, 4).toString() === "PNG"
      );
      assert.equal((await chain.input(cardIds[index]))[1], 1n);
      const reportMatch = /\/([a-f0-9]{64})\.json$/.exec(result.reportURI);
      assert(reportMatch);
      const report = JSON.parse(
        (await assets.read(reportMatch[1], "json")).toString()
      );
      assert.equal(
        portalAssetHash(await assets.read(reportMatch[1], "json")),
        result.reportHash
      );
      const metadata = await app.request(
        `/v1/portals/cards/${cardIds[index]}.json`
      );
      assert.equal(metadata.status, 200);
      const entry = await client.readContract({
        address: pool,
        abi: portalCompetitionAbi,
        functionName: "getEntry",
        args: [id]
      });
      assert(entry.completed);
      assert.equal(
        entry.score,
        result.scores.reduce((a, b) => a + b, 0)
      );
      results.push({
        ordinal: index + 1,
        tokenId: cardIds[index].toString(),
        title: spells[index].title,
        spell: spells[index].spell,
        submitter: signers[index % 3].address,
        result,
        report,
        metadata: await metadata.json()
      });
      await writeRehearsalJson(join(directory, "results.json"), results);
      console.log(
        rehearsalJson({
          step: "graded",
          ordinal: index + 1,
          scores: result.scores,
          artwork: result.artwork.hash
        })
      );
    }
    const batch = await client.readContract({
      address: pool,
      abi: portalCompetitionAbi,
      functionName: "getBatch",
      args: [1n]
    });
    assert.equal(batch.funded, 11);
    assert.equal(batch.completed, 11);
    const ranking = results
      .map((row, index) => ({
        entry: BigInt(index + 1),
        score: (row.result as { scores: readonly number[] }).scores.reduce(
          (a, b) => a + b,
          0
        )
      }))
      .sort((a, b) => b.score - a.score || Number(a.entry - b.entry));
    assert.deepEqual(
      batch.leaders,
      ranking.slice(0, 3).map((row) => row.entry)
    );
    const winner = signers[(Number(batch.leaders[0]) - 1) % 3];
    if (!state.observations.prizeBaseline)
      await run.observe(
        "prizeBaseline",
        Object.fromEntries(
          await Promise.all(
            signers.map(async (signer) => [
              signer.address.toLowerCase(),
              (await balance(signer.address)).toString()
            ])
          )
        )
      );
    await call(
      "winner-resolve",
      pool,
      portalCompetitionAbi,
      "settle",
      [1n],
      winner
    );
    const settled = await client.readContract({
      address: pool,
      abi: portalCompetitionAbi,
      functionName: "getBatch",
      args: [1n]
    });
    assert(settled.settled && settled.paid.every(Boolean));
    const expected = new Map(signers.map((s) => [s.address.toLowerCase(), 0n]));
    const prizes = [2_750_000n, 1_650_000n, 1_100_000n];
    batch.leaders.forEach((entry, rank) => {
      const address = signers[(Number(entry) - 1) % 3].address.toLowerCase();
      expected.set(address, expected.get(address)! + prizes[rank]);
    });
    const baseline = state.observations.prizeBaseline as Record<string, string>;
    for (const signer of signers)
      assert.equal(
        (await balance(signer.address)) -
          BigInt(baseline[signer.address.toLowerCase()]),
        expected.get(signer.address.toLowerCase())
      );
    assert.equal(await balance(pool), 0n);
    assert.equal(
      await client.readContract({
        address: pool,
        abi: portalCompetitionAbi,
        functionName: "totalLiability"
      }),
      0n
    );
    await call(
      "duplicate-resolution",
      pool,
      portalCompetitionAbi,
      "settle",
      [1n],
      player
    );
    for (const signer of signers)
      assert.equal(
        (await balance(signer.address)) -
          BigInt(baseline[signer.address.toLowerCase()]),
        expected.get(signer.address.toLowerCase())
      );
    await delay(4000);
    await catchUp();
    const api = await app.request("/v1/portals/competitions");
    assert.equal(api.status, 200);
    const listing = (await api.json()) as {
      competition: { batchSize: string };
      batches: {
        ready: boolean;
        settled: boolean;
        leaders: { paid: boolean }[];
      }[];
    };
    assert.equal(listing.competition.batchSize, "11");
    assert(
      listing.batches[0].ready &&
        listing.batches[0].settled &&
        listing.batches[0].leaders.every((p) => p.paid)
    );
    await writeRehearsalJson(join(directory, "competition-api.json"), listing);
    await writeRehearsalJson(join(directory, "final-verification.json"), {
      chainId: 84532,
      batchSize: 11,
      liveAI: true,
      deployment,
      source: original,
      gates,
      cards: cardIds,
      winners: batch.leaders,
      prizes,
      resolvedBy: winner.address,
      resolutionTransaction: state.transactions["winner-resolve"].hash,
      duplicateResolutionTransaction:
        state.transactions["duplicate-resolution"].hash,
      reserve: "0",
      liability: "0",
      publishedGrades: 11,
      providerCalls: usage.length,
      policyHash: portalModelPolicyHash(),
      rulesHash: testRules,
      productionBatchSize: 111,
      completedAt: new Date().toISOString()
    });
    await run.observe("completed", true);
    console.log("ELEVEN_LIVE_CHALLENGE_VERIFIED");
  } finally {
    await db.end();
  }
}
main().catch((error: unknown) => {
  const reason =
    error instanceof assert.AssertionError
      ? error.message
      : error instanceof Error && "shortMessage" in error
        ? String(error.shortMessage)
        : error instanceof Error
          ? error.name
          : "Unknown error";
  console.error(
    `Eleven-card rehearsal stopped at ${step}: ${reason.slice(0, 500).replace(/sk-[\w-]+/g, "[redacted]")}. Resume existing checkpoints.`
  );
  process.exitCode = 1;
});
