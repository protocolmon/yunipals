/** Isolated Base Sepolia rehearsal. No production addresses or operator paths belong here. */
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
  isAddress,
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
  portalModels,
  rainbowPortalGradingCase,
  portalModelPolicyHash,
  portalSpellCommitment,
  portalSpellSigningData
} from "@protopals/yunipals-market-core/portals";
import {
  portalCollectionAbi,
  portalGradingAbi,
  portalRegistryAbi
} from "@protopals/yunipals-market-core/portalAbi";
import { PortalAssets, portalAssetHash } from "../lib/portals/assets.js";
import { PortalChain } from "../lib/portals/chain.js";
import { PortalLedger } from "../lib/portals/ledger.js";
import { PortalLedgerStore } from "../lib/portals/ledger-store.js";
import { OpenAIPortalAI, type PortalAI } from "../lib/portals/provider.js";
import { applyPortalGradingCase } from "../lib/portals/grading.js";
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
type BaseArt = { variantId: number; uri: string; hash: Hex };
const wrapperAbi = parseAbi([
  "function estimateRequestPriceNative(uint32,uint32,uint256) view returns(uint256)",
  "function s_vrfCoordinator() view returns(address)"
]);
let currentStep = "configuration";

async function main() {
  process.umask(0o077);
  const path = process.env.PORTALS_REHEARSAL_ENV_FILE;
  assert(path, "Set PORTALS_REHEARSAL_ENV_FILE");
  const env = { ...process.env, ...(await readRehearsalEnv(path)) };
  for (const key of [
    "PORTALS_REHEARSAL_AI_ENV_FILE",
    "PORTALS_REHEARSAL_GRADER_ENV_FILE",
    "PORTALS_REHEARSAL_DATABASE_ENV_FILE"
  ]) {
    if (env[key]) Object.assign(env, await readRehearsalEnv(env[key]!));
  }
  const required = (key: string) => {
    assert(env[key], `Missing setting: ${key}`);
    return env[key]!;
  };
  const account = (key: string) => {
    const value = required(key);
    assert(/^0x[0-9a-fA-F]{64}$/.test(value), "Invalid signer format");
    return privateKeyToAccount(value as Hex);
  };
  const deployer = account("PORTALS_REHEARSAL_DEPLOYER_PRIVATE_KEY");
  const player = account("PORTALS_REHEARSAL_PLAYER_PRIVATE_KEY");
  const buyer = account("PORTALS_REHEARSAL_BUYER_PRIVATE_KEY");
  const grader = account("PORTALS_GRADER_PRIVATE_KEY");
  assert.equal(
    grader.address.toLowerCase(),
    required("PORTALS_GRADER_ADDRESS").toLowerCase(),
    "Unexpected grading identity"
  );
  const aiRecipient = required("PORTALS_AI_RECIPIENT") as Address;
  assert(isAddress(aiRecipient));
  const directory = required("PORTALS_REHEARSAL_DIRECTORY");
  const rpc = required("PORTALS_RPC_URL");
  const local = process.argv.includes("--local");
  if (local)
    assert(
      ["127.0.0.1", "localhost", "[::1]"].includes(new URL(rpc).hostname),
      "Local mocks require a loopback RPC"
    );
  const wallets = {
    deployer: deployer.address,
    player: player.address,
    buyer: buyer.address,
    grader: grader.address
  };
  let state: RehearsalState;
  try {
    state = JSON.parse(
      await readFile(join(directory, "state.json"), "utf8")
    ) as RehearsalState;
    assert.deepEqual(state.wallets, wallets, "Rehearsal signer changed");
    assert.equal(state.chainId, 84532);
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
    rpc,
    directory,
    state,
    parseEther(env.PORTALS_REHEARSAL_MAX_SPEND_ETH ?? "0.003")
  );
  await run.verifyNetwork();
  const client = run.client;
  const artifactDirectory = required("PORTALS_REHEARSAL_ARTIFACT_DIRECTORY");
  const artifacts = new Map<string, Artifact>();
  async function artifact(file: string) {
    const existing = artifacts.get(file);
    if (existing) return existing;
    const [source, name = source] = file.split(":");
    const bytes = await readFile(
      join(artifactDirectory, `${source}.sol`, `${name}.json`)
    );
    await run.verifyArtifact(file, bytes);
    const value = JSON.parse(bytes.toString()) as Artifact;
    artifacts.set(file, value);
    return value;
  }
  async function deploy(
    step: string,
    file: string,
    args: readonly unknown[] = []
  ) {
    currentStep = step;
    const compiled = await artifact(file);
    const receipt = await run.transaction(
      step,
      deployer,
      encodeDeployData({
        abi: compiled.abi,
        bytecode: compiled.bytecode.object,
        args
      })
    );
    assert(receipt.contractAddress);
    return receipt.contractAddress;
  }
  async function call(
    step: string,
    address: Address,
    abi: Abi,
    fn: string,
    args: readonly unknown[] = [],
    signer: LocalAccount = deployer,
    value = 0n
  ) {
    currentStep = step;
    return run.transaction(
      step,
      signer,
      encodeFunctionData({ abi, functionName: fn, args }),
      address,
      value
    );
  }
  async function proxy(name: string, args: readonly unknown[]) {
    const implementation = await deploy(`deploy-${name}`, name);
    const { abi } = await artifact(name);
    return deploy(`proxy-${name}`, "ERC1967Proxy", [
      implementation,
      encodeFunctionData({ abi, functionName: "initialize", args })
    ]);
  }
  const wrapper = required("PORTALS_VRF_WRAPPER") as Address;
  assert(isAddress(wrapper));
  const code = await client.getCode({ address: wrapper });
  assert(code && code !== "0x", "Missing VRF wrapper");
  const gasPrice = await client.getGasPrice();
  const vrfQuote = await client.readContract({
    address: wrapper,
    abi: wrapperAbi,
    functionName: "estimateRequestPriceNative",
    args: [160000, 1, gasPrice]
  });
  const balance = await client.getBalance({ address: deployer.address });
  const minimum = gasPrice * 50_000_000n + vrfQuote * 5n + parseEther("0.0003");
  const preflight = {
    chainId: 84532,
    wallets,
    balanceETH: formatEther(balance),
    currentVrfQuoteETH: formatEther(vrfQuote),
    conservativeInitialBudgetETH: formatEther(minimum),
    localMocks: local,
    executionRequested: process.argv.includes("--execute")
  };
  await run.observe("preflight", preflight);
  console.log(rehearsalJson(preflight));
  if (!process.argv.includes("--execute")) return;
  if (Object.keys(state.transactions).length === 0)
    assert(
      balance >= minimum,
      "Fund the dedicated test wallet before deployment"
    );
  required("OPENAI_API_KEY");
  const origin =
    env.PORTALS_REHEARSAL_ORIGIN ?? "https://portals-rehearsal.invalid";
  const variantsBytes = await readFile(
    required("PORTALS_REHEARSAL_VARIANTS_FILE")
  );
  await run.verifyArtifact("base-art-references", variantsBytes);
  const baseArt = JSON.parse(variantsBytes.toString()) as BaseArt[];
  assert.equal(baseArt.length, 264);
  assert.deepEqual(
    baseArt.map((a) => a.variantId).sort((a, b) => a - b),
    Array.from({ length: 264 }, (_, i) => i)
  );
  const assets = new PortalAssets(join(directory, "assets"), origin, [
    new URL(origin).hostname,
    ...new Set(baseArt.map((a) => new URL(a.uri).hostname))
  ]);
  const rainbowBytes = await readFile(
    required("PORTALS_REHEARSAL_RAINBOW_FILE")
  );
  await run.verifyArtifact("rainbow-card", rainbowBytes);
  const rainbow = await assets.put(rainbowBytes, "png");
  const rubricAsset = await assets.putJson({
    rubric: portalModels.rubric,
    policy: portalModels,
    policyHash: portalModelPolicyHash(),
    purpose: "Isolated Base Sepolia rehearsal; API is private."
  });
  const packs = await proxy("PackRegistry", [deployer.address]);
  const cards = await proxy("YunipalMonsters", [deployer.address, packs]);
  const fixture = await deploy(
    "deploy-card-fixture",
    "PortalRehearsalFixtures:PortalRehearsalCards",
    [packs]
  );
  const usdc = await deploy(
    "deploy-test-usdc",
    "PortalRehearsalFixtures:PortalRehearsalUSDC"
  );
  const { abi: packAbi } = await artifact("PackRegistry");
  const { abi: cardAbi } = await artifact("YunipalMonsters");
  const { abi: fixtureAbi } = await artifact(
    "PortalRehearsalFixtures:PortalRehearsalCards"
  );
  const { abi: testUsdcAbi } = await artifact(
    "PortalRehearsalFixtures:PortalRehearsalUSDC"
  );
  await call("configure-card-catalog", packs, packAbi, "configureType", [
    0n,
    {
      engine: fixture,
      paymentToken: usdc,
      price: 1n,
      intervalSeconds: 86400n,
      mintsPerInterval: 1,
      maxBatch: 7,
      baseGas: 450000,
      perMintGas: 250000,
      confirmations: 3,
      supplyCap: 0n,
      artworkHash: portalAssetHash(variantsBytes),
      manifestURI: rubricAsset.uri,
      metadataBaseURI: `${origin}/v1/portals/cards/`
    },
    {
      types: Array.from({ length: 11 }, (_, i) => i + 1),
      colors: [1, 2, 3, 4, 5, 6],
      horns: [1, 2],
      glitters: [0, 1],
      allowed: []
    }
  ]);
  await call("activate-card-catalog", packs, packAbi, "activate", [1n]);
  const rules = await deploy("deploy-portal-rules", "PortalRules");
  const collection = await proxy("PortalCollection", [
    deployer.address,
    wrapper,
    3,
    rules
  ]);
  const registry = await proxy("PortalRegistry", [
    deployer.address,
    collection,
    wrapper,
    3
  ]);
  const grading = await proxy("PortalGrading", [
    deployer.address,
    cards,
    registry,
    usdc,
    1n,
    `${origin}/v1/portals/cards/`
  ]);
  await run.observe("deployment", {
    packs,
    cards,
    fixture,
    usdc,
    rules,
    collection,
    registry,
    grading,
    wrapper
  });
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
  const rubricId = keccak256(toHex(portalModels.rubric));
  await call("configure-rubric", grading, portalGradingAbi, "configureRubric", [
    rubricId,
    portalModelPolicyHash(),
    20,
    rubricAsset.uri
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
  await call(
    "configure-rainbow-fees",
    grading,
    portalGradingAbi,
    "setPaymentPolicy",
    [1n, 245000n, 245000n, aiRecipient]
  );
  for (const [role, recipient] of Object.entries({
    player: player.address,
    buyer: buyer.address,
    grader: grader.address
  })) {
    if (!state.transactions[`fund-${role}`]) {
      const current = await client.getBalance({ address: recipient });
      if (current < parseEther("0.0001"))
        await run.transaction(
          `fund-${role}`,
          deployer,
          "0x",
          recipient,
          parseEther("0.0001") - current
        );
    }
  }
  // The remainder deliberately uses the same release API, ledger and durable worker.
  await runFlow();

  async function runFlow() {
    async function requestRandomness(
      step: string,
      address: Address,
      abi: Abi,
      fn: string,
      args: (maximum: bigint) => readonly unknown[]
    ) {
      const key = `${step}-maximum`;
      if (!state.observations[key]) {
        const quote = await client.readContract({
          address: wrapper,
          abi: wrapperAbi,
          functionName: "estimateRequestPriceNative",
          args: [160000, 1, await client.getGasPrice()]
        });
        await run.observe(key, ((quote * 150n) / 100n).toString());
      }
      const maximum = BigInt(String(state.observations[key]));
      const receipt = await call(
        step,
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
      assert(event, "VRF request event missing");
      return event.args.requestId;
    }
    async function waitRandomness(address: Address, id: bigint) {
      currentStep = "wait-real-vrf";
      const started = Date.now();
      for (let iteration = 0; ; iteration++) {
        const request = await client.readContract({
          address,
          abi: portalCollectionAbi,
          functionName: "randomRequests",
          args: [id]
        });
        if (request[2]) return;
        if (local) {
          const { abi } = await artifact("BoosterPacks.t:MockWrapper");
          await call(`mock-fulfillment-${id}`, wrapper, abi, "fulfill", [
            id,
            BigInt(42 + iteration)
          ]);
          continue;
        }
        assert(
          Date.now() - started < 900_000,
          "VRF still pending; resume with the same request"
        );
        if (iteration % 15 === 0)
          console.log(
            rehearsalJson({
              step: "waiting-for-vrf",
              requestId: id,
              elapsedSeconds: Math.floor((Date.now() - started) / 1000)
            })
          );
        await delay(2000);
      }
    }
    const mintId = await requestRandomness(
      "mint-three-portals",
      collection,
      portalCollectionAbi,
      "mintBatch",
      (maximum) => [
        1n,
        [deployer.address, deployer.address, deployer.address],
        maximum
      ]
    );
    await waitRandomness(collection, mintId);
    await call(
      "reveal-three-portals",
      collection,
      portalCollectionAbi,
      "finishMint",
      [mintId, 32]
    );
    const firstRotation = await requestRandomness(
      "request-first-round",
      registry,
      portalRegistryAbi,
      "requestRotation",
      (maximum) => [maximum]
    );
    await waitRandomness(registry, firstRotation);
    const activation = await call(
      "activate-first-round",
      registry,
      portalRegistryAbi,
      "activateNext"
    );
    const firstRound = parseEventLogs({
      abi: portalRegistryAbi,
      logs: activation.logs,
      eventName: "PortalActivated"
    })[0];
    assert(firstRound);
    const portalId = firstRound.args.portalId;
    const gates = (
      await client.readContract({
        address: collection,
        abi: portalCollectionAbi,
        functionName: "portalRecord",
        args: [portalId]
      })
    )[1];
    const variant = gates.typeGate * 24 + gates.colorGate * 4 + 3;
    const sequence = gates.originalOnly ? 0 : gates.sequenceStart;
    const originalRef = baseArt.find((a) => a.variantId === variant);
    assert(originalRef);
    const before = await assets.input(originalRef.uri, originalRef.hash);
    await writeRehearsalJson(join(directory, "chosen-card.json"), {
      portalId,
      gates,
      variant,
      sequence,
      originalRef
    });
    await call(
      "register-matching-art",
      grading,
      portalGradingAbi,
      "registerBaseArt",
      [[variant], [originalRef]]
    );
    const minted = await call(
      "mint-matching-card",
      fixture,
      fixtureAbi,
      "create",
      [cards, player.address, variant, sequence]
    );
    const cardEvents = parseEventLogs({
      abi: cardAbi,
      logs: minted.logs,
      eventName: "MonsterMinted"
    });
    const card = cardEvents.at(-1)?.args as { tokenId?: bigint } | undefined;
    assert(card?.tokenId);
    const cardId = card.tokenId;
    const mismatch = await call(
      "mint-mismatching-card",
      fixture,
      fixtureAbi,
      "create",
      [
        cards,
        player.address,
        ((gates.typeGate + 1) % 11) * 24 + gates.colorGate * 4 + 3,
        0
      ]
    );
    const wrong = parseEventLogs({
      abi: cardAbi,
      logs: mismatch.logs,
      eventName: "MonsterMinted"
    }).at(-1)?.args as { tokenId?: bigint } | undefined;
    assert(wrong?.tokenId);
    const facts = (await client.readContract({
      address: cards,
      abi: cardAbi,
      functionName: "cardFacts",
      args: [cardId]
    })) as readonly [number, bigint, boolean];
    assert.equal(facts[0], sequence);
    assert.equal(facts[2], true);
    assert.equal(
      await client.readContract({
        address: grading,
        abi: portalGradingAbi,
        functionName: "matches",
        args: [portalId, cardId]
      }),
      !state.transactions["burn-funded-portal"]
    );
    assert.equal(
      await client.readContract({
        address: grading,
        abi: portalGradingAbi,
        functionName: "matches",
        args: [portalId, wrong.tokenId]
      }),
      false
    );
    await call("fund-player-test-usdc", usdc, testUsdcAbi, "mint", [
      player.address,
      1_000_000n
    ]);
    await call("fund-buyer-test-usdc", usdc, testUsdcAbi, "mint", [
      buyer.address,
      1_000_000n
    ]);
    const chain = new PortalChain(client as PublicClient, {
      chainId: 84532,
      cards,
      collection,
      registry,
      grading,
      usdc
    });
    const db = local
      ? new (await import("@electric-sql/pglite")).PGlite(join(directory, "db"))
      : new pg.Pool({
          connectionString: required("PORTALS_DATABASE_URL"),
          max: 3
        });
    const store = new PortalStore(
      db as unknown as pg.Pool,
      `84532:${grading.toLowerCase()}`
    );
    const ledgerStore = new PortalLedgerStore(
      db as unknown as pg.Pool,
      `84532:${collection.toLowerCase()}:${grading.toLowerCase()}`
    );
    await store.migrate();
    await ledgerStore.migrate();
    const start = BigInt(state.transactions["proxy-PortalCollection"].block!);
    const ledger = new PortalLedger(chain, ledgerStore, start, 2n);
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
    const usageFile = join(directory, "provider-usage.json");
    let usage: Record<string, unknown>[] = [];
    try {
      usage = JSON.parse(await readFile(usageFile, "utf8")) as Record<
        string,
        unknown
      >[];
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
          service_tier?: string;
          id?: string;
        };
        usage.push({
          endpoint: String(input).split("/v1/")[1],
          model: data.model ?? portalModels.image,
          usage: data.usage ?? null,
          serviceTier: data.service_tier ?? null,
          responseId: data.id ?? null,
          recordedAt: new Date().toISOString()
        });
        await writeRehearsalJson(usageFile, usage);
      }
      return response;
    };
    const ai: PortalAI = local
      ? {
          embed: async () => [1, 0],
          edit: async (_spell, image) => ({
            bytes: Uint8Array.from(image),
            usage: null,
            model: portalModels.image
          }),
          originality: async (_spell, candidates) => ({
            copied: candidates.length > 0,
            confidence: "clear",
            meaningfulContribution: candidates.length === 0,
            reason: "Local test only",
            sources: candidates
              .filter((c) => !c.sameAuthor)
              .slice(0, 1)
              .map((c) => ({
                requestId: c.requestId,
                excerpt: c.spell,
                reason: "Local exact match"
              }))
          }),
          grade: async () => ({
            ...applyPortalGradingCase(
              rainbowPortalGradingCase,
              { creativity: 85, harmony: 87, craft: 88, impact: 90 },
              {
                creativity: "Local mock",
                harmony: "Local mock",
                craft: "Local mock",
                impact: "Local mock"
              },
              Object.fromEntries(
                rainbowPortalGradingCase.checks.map((check) => [
                  check.id,
                  {
                    outcome: "met" as const,
                    evidence:
                      "Local mocked grading result; not a visual quality assessment."
                  }
                ])
              )
            ),
            reason: "Local test only",
            usage: null,
            model: portalModels.grading
          })
        }
      : new OpenAIPortalAI(
          required("OPENAI_API_KEY"),
          portalModels,
          trackedFetch
        );
    const prepare = new PortalWorker(
      chain,
      store,
      assets,
      ai,
      portalModels,
      start,
      2n
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
            `complete-job-${id}`,
            grading,
            portalGradingAbi,
            "complete",
            [id, result],
            grader
          )
        ).transactionHash
    );
    const usdcBalance = (owner: Address) =>
      client.readContract({
        address: usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner]
      });
    if (!state.observations["initial-ai-balance"])
      await run.observe(
        "initial-ai-balance",
        (await usdcBalance(aiRecipient)).toString()
      );
    const spell =
      "Weave a miniature lighthouse made of translucent coral-colored glass around the creature's horn, with three orbiting paper manta rays and a small moon-shaped reflection in the pond. Preserve the character, colors, card framing and nameplate.";
    async function admitAttempt(attempt: number, signer: LocalAccount) {
      const label = `admit-attempt-${attempt}`;
      type Input = {
        tokenId: bigint;
        portalId: bigint;
        roundId: bigint;
        paymentVersion: bigint;
        artVersion: bigint;
        rubricId: Hex;
        maximumFee: bigint;
        inputHash: Hex;
        spellCommitment: Hex;
        nonce: bigint;
      };
      let admission: Input;
      let salt: Hex;
      const stored = state.observations[label] as
        Record<string, string> | undefined;
      if (!stored) {
        const quote = await chain.quote(cardId, signer.address);
        assert(quote.portal);
        salt = toHex(randomBytes(32));
        const input = {
          chainId: 84532,
          grading,
          submitter: signer.address,
          tokenId: cardId,
          artVersion: quote.artVersion,
          nonce: quote.nonce,
          spell,
          salt
        };
        const commitment = portalSpellCommitment(input);
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
        assert.equal(
          ((await upload.json()) as { commitment: string }).commitment,
          commitment
        );
        admission = {
          tokenId: cardId,
          portalId,
          roundId: quote.round.id,
          paymentVersion: quote.portal.payment.version,
          artVersion: quote.artVersion,
          rubricId: quote.rubricId,
          maximumFee: 490000n,
          inputHash: quote.input.hash,
          spellCommitment: commitment,
          nonce: quote.nonce
        };
        await run.observe(label, { ...admission, salt });
      } else {
        salt = stored.salt as Hex;
        admission = {
          tokenId: BigInt(stored.tokenId),
          portalId: BigInt(stored.portalId),
          roundId: BigInt(stored.roundId),
          paymentVersion: BigInt(stored.paymentVersion),
          artVersion: BigInt(stored.artVersion),
          rubricId: stored.rubricId as Hex,
          maximumFee: BigInt(stored.maximumFee),
          inputHash: stored.inputHash as Hex,
          spellCommitment: stored.spellCommitment as Hex,
          nonce: BigInt(stored.nonce)
        };
      }
      if (!state.transactions[label]) {
        await assert.rejects(
          client.simulateContract({
            account: signer.address,
            address: grading,
            abi: portalGradingAbi,
            functionName: "admit",
            args: [{ ...admission, tokenId: wrong!.tokenId! }]
          })
        );
        assert.equal(
          await client.readContract({
            address: grading,
            abi: portalGradingAbi,
            functionName: "requestCount"
          }),
          BigInt(attempt - 1)
        );
      }
      await call(
        `approve-attempt-${attempt}`,
        usdc,
        erc20Abi,
        "approve",
        [grading, 490000n],
        signer
      );
      const receipt = await call(
        label,
        grading,
        portalGradingAbi,
        "admit",
        [admission],
        signer
      );
      const event = parseEventLogs({
        abi: portalGradingAbi,
        logs: receipt.logs,
        eventName: "GradingRequested"
      })[0];
      assert(event);
      return event.args.requestId;
    }
    async function confirmedIngest() {
      await delay(local ? 50 : 6000);
      for (let i = 0; i < 12; i++) {
        await prepare.ingest();
        if (local) await client.request({ method: "evm_mine" as never });
      }
    }
    async function jobFor(id: bigint) {
      await confirmedIngest();
      const job = await store.claim(portalModelPolicyHash());
      assert(
        job && job.requestId === id.toString(),
        "Expected grading job is leased or not confirmed; resume after lease expiry"
      );
      return job;
    }
    try {
      const firstId = await admitAttempt(1, player);
      const nextId = await requestRandomness(
        "stage-second-round",
        registry,
        portalRegistryAbi,
        "requestRotation",
        (maximum) => [maximum]
      );
      if (!(await chain.request(firstId)).completed) {
        currentStep = "first-live-ai-job";
        const job = await jobFor(firstId);
        await worker.process(job);
      }
      await call(
        "transfer-monster-to-buyer",
        cards,
        cardAbi,
        "transferFrom",
        [player.address, buyer.address, cardId],
        player
      );
      assert.equal(
        (await chain.owner(cardId)).toLowerCase(),
        buyer.address.toLowerCase()
      );
      assert.equal((await chain.input(cardId))[1], 1n);
      const secondId = await admitAttempt(2, buyer);
      let secondJob;
      if (!(await chain.request(secondId)).completed) {
        currentStep = "second-live-ai-job";
        secondJob = await jobFor(secondId);
        await prepare.process(secondJob);
        assert(secondJob.progress.completion);
        assert.equal(
          secondJob.progress.originality?.copied,
          true,
          "Distinctive exact copying should receive evidence"
        );
        const completion = secondJob.progress.completion;
        const output = completion.artwork as { hash: string; uri: string };
        const alreadyPublished = await store.isPublishedArtifact(
          output.hash.slice(2)
        );
        assert.equal(
          (await app.request(new URL(output.uri).pathname)).status,
          alreadyPublished ? 200 : 404,
          "Unconfirmed artwork must remain private"
        );
        await run.observe("copying-result", {
          base: secondJob.progress.grading?.scores,
          finding: secondJob.progress.originality,
          final: completion.scores
        });
      }
      assert.equal(
        (await usdcBalance(aiRecipient)) -
          BigInt(String(state.observations["initial-ai-balance"])),
        490000n
      );
      if (!state.transactions["burn-funded-portal"]) {
        assert.equal(await usdcBalance(grading), 490000n);
        assert.equal(
          await client.readContract({
            address: grading,
            abi: portalGradingAbi,
            functionName: "totalPortalLiability"
          }),
          490000n
        );
      }
      await call(
        "transfer-funded-portal",
        collection,
        portalCollectionAbi,
        "transferFrom",
        [deployer.address, buyer.address, portalId]
      );
      if (!state.transactions["burn-funded-portal"]) {
        await assert.rejects(
          client.simulateContract({
            account: deployer.address,
            address: grading,
            abi: portalGradingAbi,
            functionName: "burnAndClaim",
            args: [portalId, 0n, (await client.getBlock()).timestamp + 600n]
          })
        );
        await run.observe(
          "buyer-balance-before-claim",
          (await usdcBalance(buyer.address)).toString()
        );
        await run.observe(
          "claim-deadline",
          ((await client.getBlock()).timestamp + 600n).toString()
        );
      }
      const claim = await call(
        "burn-funded-portal",
        grading,
        portalGradingAbi,
        "burnAndClaim",
        [
          portalId,
          490000n,
          BigInt(String(state.observations["claim-deadline"]))
        ],
        buyer
      );
      const claimed = parseEventLogs({
        abi: portalGradingAbi,
        logs: claim.logs,
        eventName: "PortalClaimed"
      })[0];
      assert(
        claimed &&
          claimed.args.amount === 490000n &&
          claimed.args.owner.toLowerCase() === buyer.address.toLowerCase()
      );
      assert.equal(
        await usdcBalance(buyer.address),
        BigInt(String(state.observations["buyer-balance-before-claim"])) +
          490000n
      );
      assert.equal(
        await client.readContract({
          address: grading,
          abi: portalGradingAbi,
          functionName: "totalPortalLiability"
        }),
        0n
      );
      assert.equal(await usdcBalance(grading), 0n);
      assert.equal(
        await client.readContract({
          address: collection,
          abi: portalCollectionAbi,
          functionName: "exists",
          args: [portalId]
        }),
        false
      );
      assert.equal(
        (
          await client.readContract({
            address: registry,
            abi: portalRegistryAbi,
            functionName: "activePortal"
          })
        )[1],
        false
      );
      if (secondJob) {
        currentStep = "complete-after-portal-burn";
        await worker.process(secondJob);
      }
      assert.equal((await chain.request(secondId)).completed, true);
      assert.equal((await chain.input(cardId))[1], 2n);
      const result = await chain.result(secondId);
      assert.equal(result.copied, true);
      assert(result.scores[0] <= 20);
      assert.equal(
        (
          await client.readContract({
            address: grading,
            abi: portalGradingAbi,
            functionName: "completedBy",
            args: [secondId]
          })
        ).toLowerCase(),
        grader.address.toLowerCase()
      );
      const history = await app.request(`/v1/portals/cards/${cardId}`);
      assert.equal(history.status, 200);
      const metadata = await app.request(`/v1/portals/cards/${cardId}.json`);
      assert.equal(metadata.status, 200);
      assert.equal(
        (await app.request(new URL(result.artwork.uri).pathname)).status,
        200
      );
      await writeRehearsalJson(
        join(directory, "card-history.json"),
        await history.json()
      );
      await writeRehearsalJson(
        join(directory, "card-metadata.json"),
        await metadata.json()
      );
      await waitRandomness(registry, nextId);
      const end = firstRound.args.endsAt;
      if ((await client.getBlock()).timestamp < end) {
        await assert.rejects(
          client.simulateContract({
            account: deployer.address,
            address: registry,
            abi: portalRegistryAbi,
            functionName: "activateNext"
          })
        );
        currentStep = "wait-for-660-second-slot";
        if (local) {
          await client.request({
            method: "evm_setNextBlockTimestamp" as never,
            params: [Number(end)] as never
          });
          await client.request({ method: "evm_mine" as never });
        } else {
          for (;;) {
            const remaining = end - (await client.getBlock()).timestamp;
            if (remaining <= 0n) break;
            console.log(
              rehearsalJson({
                step: "waiting-for-original-slot-end",
                remainingSeconds: remaining
              })
            );
            await delay(Math.min(Number(remaining) * 1000, 30000));
          }
        }
      }
      await call(
        "activate-second-round",
        registry,
        portalRegistryAbi,
        "activateNext"
      );
      const [next, open] = await client.readContract({
        address: registry,
        abi: portalRegistryAbi,
        functionName: "activePortal"
      });
      assert(open && next.portalId !== portalId);
      assert.equal(next.endsAt - next.startsAt, 660n);
      const zeroPortal = [1n, 2n, 3n].find(
        (id) => id !== portalId && id !== next.portalId
      )!;
      if (!state.observations["zero-claim-deadline"])
        await run.observe(
          "zero-claim-deadline",
          ((await client.getBlock()).timestamp + 600n).toString()
        );
      await call(
        "burn-zero-balance-portal",
        grading,
        portalGradingAbi,
        "burnAndClaim",
        [
          zeroPortal,
          0n,
          BigInt(String(state.observations["zero-claim-deadline"]))
        ]
      );
      assert.equal(
        await client.readContract({
          address: collection,
          abi: portalCollectionAbi,
          functionName: "livePortalCount",
          args: [0n]
        }),
        1n
      );
      await delay(local ? 50 : 6000);
      for (let i = 0; i < 12; i++) await ledger.tick();
      const owners = await app.request(
        `/v1/portals/owners/${deployer.address}`
      );
      const claims = await app.request(
        `/v1/portals/owners/${buyer.address}/claims`
      );
      const detail = await app.request(`/v1/portals/tokens/${portalId}`);
      assert.equal(owners.status, 200);
      assert.equal(claims.status, 200);
      assert.equal(detail.status, 200);
      await writeRehearsalJson(join(directory, "owner-api.json"), {
        holdings: await owners.json(),
        claims: await claims.json(),
        retired: await detail.json()
      });
      await run.observe("completed", {
        realChainlinkVrf: !local,
        liveOpenAI: !local,
        privateApi: true,
        cardFixture: true,
        portalId,
        cardId,
        firstId,
        secondId,
        claimAmount: 490000,
        livePortals: 1,
        windowSeconds: 660,
        completedAt: new Date().toISOString()
      });
      console.log(
        rehearsalJson({
          status: "rehearsal-passed",
          directory,
          realVrf: !local,
          liveAI: !local
        })
      );
    } finally {
      if ("end" in db) await db.end();
      else await db.close();
    }
  }
}

main().catch(async (error: unknown) => {
  console.error(
    rehearsalJson({
      status: "rehearsal-stopped",
      step: currentStep,
      errorType: error instanceof Error ? error.name : "UnknownError",
      ...(error instanceof Error && error.name === "AssertionError"
        ? { assertion: error.message.slice(0, 2000) }
        : {})
    })
  );
  process.exitCode = 1;
});
