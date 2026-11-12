/** Historical V1 overlapping-batch fixture; archived release artifacts only. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
  zeroAddress,
  zeroHash,
  type Abi,
  type Address,
  type Hex,
  type LocalAccount
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  portalCollectionAbi,
  portalRegistryAbi,
  portalGradingAbi,
  portalCompetitionAbi
} from "@protopals/yunipals-market-core/portalAbi";
import {
  PortalRehearsal,
  readRehearsalEnv,
  writeRehearsalJson,
  rehearsalJson,
  type RehearsalState
} from "../lib/portals/rehearsal.js";

type Artifact = {
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex };
};
type Deployment = {
  packs: Address;
  cards: Address;
  fixture: Address;
  usdc: Address;
  collection: Address;
  registry: Address;
  grading: Address;
  wrapper: Address;
};
const cardAbi = parseAbi([
  "function ownerOf(uint256) view returns(address)",
  "function nextTokenId() view returns(uint256)"
]);
const fixtureAbi = parseAbi(["function create(address,address,uint32,uint32)"]);
let step = "configuration";

async function main() {
  process.umask(0o077);
  assert(
    process.env.PORTALS_REHEARSAL_ENV_FILE,
    "Set the existing isolated rehearsal env file"
  );
  const env = {
    ...(await readRehearsalEnv(process.env.PORTALS_REHEARSAL_ENV_FILE)),
    ...process.env
  };
  assert(env.PORTALS_REHEARSAL_GRADER_ENV_FILE);
  Object.assign(
    env,
    await readRehearsalEnv(env.PORTALS_REHEARSAL_GRADER_ENV_FILE)
  );
  const required = (key: string) => {
    assert(env[key], `Missing ${key}`);
    return env[key]!;
  };
  const account = (key: string) => privateKeyToAccount(required(key) as Hex);
  const deployer = account("PORTALS_REHEARSAL_DEPLOYER_PRIVATE_KEY");
  const player = account("PORTALS_REHEARSAL_PLAYER_PRIVATE_KEY");
  const buyer = account("PORTALS_REHEARSAL_BUYER_PRIVATE_KEY");
  const grader = account("PORTALS_GRADER_PRIVATE_KEY");
  const directory = required("PORTALS_COMPETITION_REHEARSAL_DIRECTORY");
  const previous = JSON.parse(
    await readFile(
      join(required("PORTALS_REHEARSAL_DIRECTORY"), "state.json"),
      "utf8"
    )
  ) as RehearsalState;
  assert.equal(previous.chainId, 84532);
  assert(
    previous.observations.completed,
    "Previous isolated rehearsal was not verified complete"
  );
  const wallets = {
    deployer: deployer.address,
    player: player.address,
    buyer: buyer.address,
    grader: grader.address
  };
  assert.deepEqual(
    previous.wallets,
    wallets,
    "Dedicated test wallet identity changed"
  );
  const deployment = previous.observations.deployment as Deployment;
  assert(deployment?.grading && deployment?.fixture, "Missing isolated stack");
  let state: RehearsalState;
  try {
    state = JSON.parse(
      await readFile(join(directory, "state.json"), "utf8")
    ) as RehearsalState;
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
      observations: { deployment }
    };
  }
  const run = new PortalRehearsal(
    required("PORTALS_RPC_URL"),
    directory,
    state,
    parseEther(env.PORTALS_COMPETITION_MAX_SPEND_ETH ?? "0.003")
  );
  await run.verifyNetwork();
  const client = run.client;
  const at = await client.getBlock();
  const gasPrice = await client.getGasPrice();
  const balances = await Promise.all(
    Object.entries(wallets).map(async ([name, address]) => [
      name,
      formatEther(await client.getBalance({ address }))
    ])
  );
  const [controller, live, rotationQuote] = await Promise.all([
    client.readContract({
      address: deployment.collection,
      abi: portalCollectionAbi,
      functionName: "claimController"
    }),
    client.readContract({
      address: deployment.collection,
      abi: portalCollectionAbi,
      functionName: "livePortalCount",
      args: [0n]
    }),
    client.readContract({
      address: deployment.registry,
      abi: portalRegistryAbi,
      functionName: "quoteRandomness",
      args: [gasPrice]
    })
  ]);
  assert.equal(controller.toLowerCase(), deployment.grading.toLowerCase());
  assert.equal(
    live,
    1n,
    "This rehearsal expects the sole surviving test portal"
  );
  const inspection = {
    chainId: 84532,
    block: at.number,
    wallets: Object.fromEntries(balances),
    gasPrice: gasPrice.toString(),
    rotationQuote: formatEther(rotationQuote),
    deployment,
    testGrades: "deterministic fixtures; no paid AI calls"
  };
  if (!process.argv.includes("--execute")) {
    console.log(rehearsalJson(inspection));
    return;
  }
  await run.observe("inspection", inspection);
  const artifacts = new Map<string, Artifact>();
  async function artifact(name: string) {
    if (artifacts.has(name)) return artifacts.get(name)!;
    const bytes = await readFile(
      join(required("PORTALS_COMPETITION_ARTIFACT_DIRECTORY"), `${name}.json`)
    );
    await run.verifyArtifact(name, bytes);
    const value = JSON.parse(bytes.toString()) as Artifact;
    artifacts.set(name, value);
    return value;
  }
  const legacyPool = await artifact("PortalGradingCompetition");
  assert(
    !legacyPool.abi.some(
      (item) =>
        item.type === "function" &&
        "name" in item &&
        item.name === "publishTheme"
    ),
    "This historical overlap rehearsal requires archived V1 artifacts. Use the sequential-theme integration for the current release."
  );

  async function deploy(
    name: string,
    args: readonly unknown[] = [],
    key = name
  ) {
    step = `deploy-${key}`;
    const a = await artifact(name);
    const receipt = await run.transaction(
      step,
      deployer,
      encodeDeployData({ abi: a.abi, bytecode: a.bytecode.object, args })
    );
    assert(receipt.contractAddress);
    return receipt.contractAddress;
  }
  async function call(
    name: string,
    to: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[] = [],
    signer: LocalAccount = deployer,
    value = 0n
  ) {
    step = name;
    return run.transaction(
      name,
      signer,
      encodeFunctionData({ abi, functionName, args }),
      to,
      value
    );
  }
  const { grading, collection, registry, cards, fixture, usdc } = deployment;
  if (!state.observations.legacyBindings) {
    const count = await client.readContract({
      address: grading,
      abi: portalGradingAbi,
      functionName: "requestCount"
    });
    assert.equal(count, 2n, "Unexpected test stack activity");
    const bindings = await Promise.all(
      [1n, 2n].map((id) =>
        client.readContract({
          address: grading,
          abi: portalGradingAbi,
          functionName: "requestBinding",
          args: [id]
        })
      )
    );
    await run.observe("legacyBindings", bindings);
  }
  const implementation = await deploy("PortalGrading");
  await call(
    "upgrade-isolated-grading",
    grading,
    portalGradingAbi,
    "upgradeToAndCall",
    [implementation, "0x"]
  );
  for (const [index, id] of [1n, 2n].entries()) {
    assert.equal(
      await client.readContract({
        address: grading,
        abi: portalGradingAbi,
        functionName: "requestBinding",
        args: [id]
      }),
      (state.observations.legacyBindings as string[])[index]
    );
  }
  const poolImplementation = await deploy("PortalGradingCompetition");
  const pool = await deploy(
    "ERC1967Proxy",
    [
      poolImplementation,
      encodeFunctionData({
        abi: portalCompetitionAbi,
        functionName: "initialize",
        args: [deployer.address, grading, usdc]
      })
    ],
    "competition-proxy"
  );
  await call(
    "bind-competition",
    grading,
    portalGradingAbi,
    "configureCompetition",
    [pool]
  );
  await run.observe("competition", pool);
  const rules = await client.readContract({
    address: pool,
    abi: portalCompetitionAbi,
    functionName: "RULES_HASH"
  });
  const snapshot = await client.readContract({
    address: collection,
    abi: portalCollectionAbi,
    functionName: "poolSnapshot",
    args: [0n]
  });
  const portal = await client.readContract({
    address: collection,
    abi: portalCollectionAbi,
    functionName: "portalAtSnapshot",
    args: [0n, snapshot[0], 0n]
  });
  const gates = await client.readContract({
    address: collection,
    abi: portalCollectionAbi,
    functionName: "gates",
    args: [portal]
  });
  const variant = gates.typeGate * 24 + gates.colorGate * 4 + 3;
  const sequence = gates.originalOnly ? 0 : gates.sequenceStart;
  const artReferences = JSON.parse(
    await readFile(required("PORTALS_REHEARSAL_VARIANTS_FILE"), "utf8")
  ) as { variantId: number; uri: string; hash: Hex }[];
  const artReference = artReferences.find(
    (value) => value.variantId === variant
  );
  assert(artReference);
  const art = artReference;
  const registered = await client.readContract({
    address: grading,
    abi: portalGradingAbi,
    functionName: "baseArt",
    args: [variant]
  });
  if (registered.hash === zeroHash)
    await call(
      "register-test-input",
      grading,
      portalGradingAbi,
      "registerBaseArt",
      [[variant], [{ uri: art.uri, hash: art.hash }]]
    );
  else assert.equal(registered.hash, art.hash);
  const signers = [player, buyer, deployer];
  for (const signer of signers) {
    await call(
      `mint-currency-${signer.address}`,
      usdc,
      parseAbi(["function mint(address,uint256)"]),
      "mint",
      [signer.address, 100_000_000n]
    );
    await call(
      `approve-${signer.address}`,
      usdc,
      erc20Abi,
      "approve",
      [grading, 100_000_000n],
      signer
    );
  }
  for (let ordinal = 1; ordinal <= 4; ordinal++) {
    const label = `card-${ordinal}`;
    if (!state.observations[label]) {
      let original: bigint;
      if (state.observations[`${label}-original`])
        original = BigInt(String(state.observations[`${label}-original`]));
      else {
        original = await client.readContract({
          address: cards,
          abi: cardAbi,
          functionName: "nextTokenId"
        });
        await run.observe(`${label}-original`, original);
      }
      const signer = signers[(ordinal - 1) % 3];
      await call(`mint-${label}`, fixture, fixtureAbi, "create", [
        cards,
        signer.address,
        variant,
        sequence
      ]);
      const token = original + (sequence ? 1n : 0n);
      assert.equal(
        (
          await client.readContract({
            address: cards,
            abi: cardAbi,
            functionName: "ownerOf",
            args: [token]
          })
        ).toLowerCase(),
        signer.address.toLowerCase()
      );
      assert(
        await client.readContract({
          address: grading,
          abi: portalGradingAbi,
          functionName: "matches",
          args: [portal, token]
        })
      );
      await run.observe(label, {
        token: token.toString(),
        submitter: signer.address
      });
    }
  }
  if (process.argv.includes("--prepare-only")) {
    console.log("Competition stack and four matching test cards prepared");
    return;
  }
  // Fund only dedicated test wallets. Persist exact amounts so a resume cannot transfer twice.
  const targets = [
    ["player", player.address, parseEther("0.00022")],
    ["buyer", buyer.address, parseEther("0.00022")],
    ["grader", grader.address, parseEther("0.00060")]
  ] as const;
  let needed = 0n;
  for (const [name, address, target] of targets) {
    if (state.transactions[`fund-${name}`]) continue;
    const balance = await client.getBalance({ address });
    const amount = target > balance ? target - balance : 0n;
    if (!state.observations[`fund-${name}-amount`])
      await run.observe(`fund-${name}-amount`, amount);
    needed += BigInt(String(state.observations[`fund-${name}-amount`]));
  }
  assert(
    (await client.getBalance({ address: deployer.address })) >=
      needed + parseEther("0.00025"),
    "Dedicated test wallet needs its requested test ETH top-up"
  );
  for (const [name, address] of targets) {
    const amount = BigInt(
      String(state.observations[`fund-${name}-amount`] ?? 0)
    );
    if (amount) {
      step = `fund-${name}`;
      await run.transaction(step, deployer, "0x", address, amount);
    }
  }
  async function activeRound() {
    let [round, open] = await client.readContract({
      address: registry,
      abi: portalRegistryAbi,
      functionName: "activePortal"
    });
    if (open && round.endsAt > (await client.getBlock()).timestamp + 25n)
      return round;
    let pending = await client.readContract({
      address: registry,
      abi: portalRegistryAbi,
      functionName: "pendingRotation"
    });
    const key = `rotation-${round.id + 1n}`;
    if (pending === 0n) {
      let maximum = state.observations[`${key}-maximum`];
      if (!maximum) {
        maximum = (
          ((await client.readContract({
            address: registry,
            abi: portalRegistryAbi,
            functionName: "quoteRandomness",
            args: [await client.getGasPrice()]
          })) *
            150n) /
          100n
        ).toString();
        await run.observe(`${key}-maximum`, maximum);
      }
      await call(
        key,
        registry,
        portalRegistryAbi,
        "requestRotation",
        [BigInt(String(maximum))],
        deployer,
        BigInt(String(maximum))
      );
      pending = await client.readContract({
        address: registry,
        abi: portalRegistryAbi,
        functionName: "pendingRotation"
      });
    }
    for (let tries = 0; ; tries++) {
      const result = await client.readContract({
        address: registry,
        abi: portalRegistryAbi,
        functionName: "randomRequests",
        args: [pending]
      });
      const now = (await client.getBlock()).timestamp;
      if (result[2] && now >= round.endsAt) break;
      assert(
        tries < 180,
        "VRF delivery still pending; resume the same request"
      );
      if (tries % 6 === 0)
        console.log(
          rehearsalJson({
            step: "waiting-real-vrf",
            request: pending,
            received: result[2]
          })
        );
      await delay(5000);
    }
    await call(
      `activate-${pending}`,
      registry,
      portalRegistryAbi,
      "activateNext"
    );
    [round, open] = await client.readContract({
      address: registry,
      abi: portalRegistryAbi,
      functionName: "activePortal"
    });
    assert(open && round.portalId === portal);
    return round;
  }
  const initialRequestCount = 2n;
  async function complete(ordinal: number) {
    const id = initialRequestCount + BigInt(ordinal);
    const request = await client.readContract({
      address: grading,
      abi: portalGradingAbi,
      functionName: "getRequest",
      args: [id]
    });
    const rubric = await client.readContract({
      address: grading,
      abi: portalGradingAbi,
      functionName: "rubric",
      args: [request.rubricId]
    });
    const score =
      ordinal === 112
        ? 100
        : ordinal >= 109
          ? ordinal - 12
          : 30 + (ordinal % 60);
    const report = {
      kind: "deterministic-competition-rehearsal",
      ordinal,
      requestId: id.toString(),
      scores: [score, score, score, score],
      paidAI: false
    };
    await writeRehearsalJson(join(directory, `report-${ordinal}.json`), report);
    const result = {
      requestBinding: await client.readContract({
        address: grading,
        abi: portalGradingAbi,
        functionName: "requestBinding",
        args: [id]
      }),
      artwork: { uri: art.uri, hash: art.hash },
      scores: [score, score, score, score],
      baseCreativity: score,
      copied: false,
      evidenceHash: zeroHash,
      reportHash: keccak256(toHex(JSON.stringify(report))),
      modelsHash: rubric.modelPolicy,
      reportURI: `ipfs://competition-rehearsal/reports/${ordinal}`,
      spellURI: `ipfs://competition-rehearsal/spells/${ordinal}`,
      completedAt: 0n
    };
    await call(
      `grade-${ordinal}`,
      grading,
      portalGradingAbi,
      "complete",
      [id, result],
      grader
    );
    const entry = await client.readContract({
      address: pool,
      abi: portalCompetitionAbi,
      functionName: "getEntry",
      args: [BigInt(ordinal)]
    });
    assert(entry.completed && entry.score === score * 4);
  }

  if (!process.argv.includes("--finish-only"))
    for (let ordinal = 1; ordinal <= 112; ordinal++) {
      const label = `admission-${ordinal}`;
      const signer = signers[(ordinal - 1) % 3];
      const cardIndex = ordinal === 112 ? 4 : ((ordinal - 1) % 3) + 1;
      const card = state.observations[`card-${cardIndex}`] as { token: string };
      let saved = state.observations[label] as
        Record<string, string> | undefined;
      if (!saved) {
        const round = await activeRound();
        const input = await client.readContract({
          address: grading,
          abi: portalGradingAbi,
          functionName: "inputArtwork",
          args: [BigInt(card.token)]
        });
        const payment = await client.readContract({
          address: grading,
          abi: portalGradingAbi,
          functionName: "paymentPolicies",
          args: [1n]
        });
        const rubricId = await client.readContract({
          address: grading,
          abi: portalGradingAbi,
          functionName: "activeRubric"
        });
        const nonce = await client.readContract({
          address: grading,
          abi: portalGradingAbi,
          functionName: "nonces",
          args: [signer.address]
        });
        saved = {
          tokenId: card.token,
          portalId: portal.toString(),
          roundId: round.id.toString(),
          paymentVersion: payment[4].toString(),
          artVersion: input[1].toString(),
          rubricId,
          maximumFee: "990000",
          inputHash: input[0].hash,
          spellCommitment: keccak256(
            toHex(`deterministic competition rehearsal ${ordinal}`)
          ),
          nonce: nonce.toString()
        };
        await run.observe(label, saved);
      }
      const admission = {
        ...saved,
        tokenId: BigInt(saved.tokenId),
        portalId: BigInt(saved.portalId),
        roundId: BigInt(saved.roundId),
        paymentVersion: BigInt(saved.paymentVersion),
        artVersion: BigInt(saved.artVersion),
        maximumFee: BigInt(saved.maximumFee),
        inputHash: saved.inputHash as Hex,
        rubricId: saved.rubricId as Hex,
        spellCommitment: saved.spellCommitment as Hex,
        nonce: BigInt(saved.nonce)
      };
      const receipt = await call(
        label,
        grading,
        portalGradingAbi,
        "admitCompetition",
        [admission, pool, rules],
        signer
      );
      const accepted = parseEventLogs({
        abi: portalCompetitionAbi,
        logs: receipt.logs,
        eventName: "CompetitionEntered"
      })[0];
      assert(
        accepted &&
          accepted.args.entryId === BigInt(ordinal) &&
          accepted.args.requestId === initialRequestCount + BigInt(ordinal)
      );
      if (ordinal !== 111) await complete(ordinal);
    }
  if (!process.argv.includes("--hold-final")) await complete(111);
  const first = await client.readContract({
    address: pool,
    abi: portalCompetitionAbi,
    functionName: "getBatch",
    args: [1n]
  });
  const second = await client.readContract({
    address: pool,
    abi: portalCompetitionAbi,
    functionName: "getBatch",
    args: [2n]
  });
  assert.equal(first.funded, 111);
  assert.equal(second.funded, 1);
  assert.equal(second.completed, 1);
  if (!process.argv.includes("--hold-final")) {
    assert.equal(first.completed, 111);
    assert.deepEqual(first.leaders, [111n, 110n, 109n]);
  }
  const proof = {
    chainId: 84532,
    deployment,
    competition: pool,
    first,
    second,
    fixtures: true,
    actualPaidAI: false,
    chainlinkSettlementVerified: false,
    gradedAt: new Date().toISOString()
  };
  await writeRehearsalJson(join(directory, "batch-verification.json"), proof);
  await run.observe("batch", proof);
  console.log(
    rehearsalJson({
      status: "sepolia-batch-ready",
      pool,
      funded: first.funded,
      completed: first.completed,
      settlement: first.settled ? "already-settled" : "awaiting-live-CRE"
    })
  );
}

main().catch(() => {
  console.error(
    rehearsalJson({
      status: "rehearsal-needs-attention",
      step,
      details:
        "Inspect the private state and canonical receipts; no signing key is logged."
    })
  );
  process.exitCode = 1;
});
