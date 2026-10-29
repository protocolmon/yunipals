/** Read-only deployment review. Never loads keys, signs, broadcasts or starts services. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const ordered = (value) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, value[key]])
    )
  );
const address = (value) =>
  typeof value === "string" &&
  /^0x[0-9a-f]{40}$/i.test(value) &&
  !/^0x0{40}$/.test(value);
const block = (value) =>
  /^(?:[1-9][0-9]*)$/.test(String(value)) && BigInt(value) < 2n ** 64n;

export function animeLaunchBlockers(deployment) {
  const blockers = [];
  if (deployment.chainId !== 8453) blockers.push("Base chain ID is required.");
  for (const key of ["registry", "arena"])
    if (!address(deployment[key]))
      blockers.push(`${key}: real deployed address is required.`);
  if (
    address(deployment.registry) &&
    address(deployment.arena) &&
    deployment.registry.toLowerCase() === deployment.arena.toLowerCase()
  )
    blockers.push("Registry and arena must be separate contracts.");
  for (const key of ["registryDeploymentBlock", "arenaDeploymentBlock"])
    if (!block(deployment[key]))
      blockers.push(`${key}: confirmed deployment block is required.`);
  if (
    typeof deployment.rulesHash !== "string" ||
    !/^0x[0-9a-f]{64}$/i.test(deployment.rulesHash) ||
    /^0x0{64}$/.test(deployment.rulesHash)
  )
    blockers.push(
      "Rules hash must bind the deployed registry and final release."
    );
  if (!Array.isArray(deployment.remainingLiveAcceptance))
    blockers.push("Live acceptance checklist is missing.");
  else
    for (const item of deployment.remainingLiveAcceptance)
      blockers.push(`Live acceptance: ${item}`);
  return blockers;
}

export async function animeReleasePreflight(repository = root) {
  const checks = [],
    files = {};
  const verify = async (label, check) => {
    try {
      await check();
      checks.push({ label, passed: true });
    } catch (error) {
      checks.push({ label, passed: false, detail: error.message });
    }
  };
  let engine, recipe;
  for (const [label, folder, file] of [
    ["Frozen anime engine", "apps/yunipals-anime-engine", "engine-lock.json"],
    ["Frozen fighter recipe", "docs/arena/anime-recipe-v1", "recipe-lock.json"],
    [
      "Frozen fighter recipe v2",
      "docs/arena/anime-recipe-v2",
      "recipe-lock.json"
    ]
  ])
    await verify(label, async () => {
      const lock = await json(join(repository, folder, file));
      if (hash(ordered(lock.files)) !== lock.sha256)
        throw new Error("Invalid aggregate checksum.");
      for (const [name, expected] of Object.entries(lock.files)) {
        if (
          !/^[A-Za-z0-9_./-]+$/.test(name) ||
          name.split("/").includes("..") ||
          name.startsWith("/")
        )
          throw new Error("Invalid locked asset path.");
        const actual = hash(await readFile(join(repository, folder, name)));
        if (actual !== expected)
          throw new Error(`Locked file changed: ${name}`);
        files[`${folder}/${name}`] = actual;
      }
      if (label === "Frozen anime engine") engine = lock;
      else recipe = lock;
    });
  await verify("Engine package and browser pin", async () => {
    const pkg = await json(
      join(repository, "apps/yunipals-anime-engine/package.json")
    );
    const golden = await json(
      join(repository, "apps/yunipals-anime-engine/fixtures/golden.json")
    );
    const automated = await json(
      join(
        repository,
        "apps/yunipals-anime-engine/fixtures/automated-golden.json"
      )
    );
    if (
      pkg.version !== engine?.version ||
      golden.engineVersion !== engine?.version ||
      golden.chromium !== engine?.chromium ||
      automated.engineVersion !== engine?.version ||
      automated.chromium !== engine?.chromium
    )
      throw new Error("Package, engine and golden browser pins differ.");
  });
  await verify("Approved economics and timing", async () => {
    const economics = await json(
      join(repository, "contracts/arena/config/anime-economics.json")
    );
    const timing = await json(
      join(repository, "contracts/arena/config/anime-timing.json")
    );
    if (
      economics.entryFeeRaw !== "1000000" ||
      economics.winnerBps !== 8000 ||
      economics.islandBps !== 500 ||
      economics.operationsBps !== 1500 ||
      economics.chainId !== 8453
    )
      throw new Error("Economics differ from approval.");
    if (
      timing.joinWindow.seconds !== 604800 ||
      timing.strategyWindow.seconds !== 86400 ||
      timing.resolutionWindow.seconds !== 86400
    )
      throw new Error("Timing differs from approval.");
  });
  await verify("Pilot configuration starts closed", async () => {
    const contents = await readFile(
      join(repository, "ops/anime-arena/runtime.env.example"),
      "utf8"
    );
    for (const setting of [
      "ARENA_MEDIA_KIND=anime",
      "ARENA_INDEXER_MODE=unified",
      "ARENA_ENTRIES_ENABLED=false",
      "ARENA_NEW_LOBBIES_ENABLED=false",
      "ARENA_LAUNCH_MODE=pilot"
    ])
      if (!contents.split(/\r?\n/).includes(setting))
        throw new Error(`Missing safe default: ${setting}`);
  });
  await verify(
    "Claude credentials isolated to media and capacity",
    async () => {
      for (const service of ["media", "capacity"]) {
        const text = await readFile(
          join(
            repository,
            `ops/anime-arena/yunipals-anime-arena-${service}.service`
          ),
          "utf8"
        );
        if (
          !text.includes(
            "EnvironmentFile=/etc/yunipals-anime-arena/openrouter.env"
          )
        )
          throw new Error(`Missing Claude credential file for ${service}.`);
      }
      for (const service of [
        "api",
        "referee",
        "lobby",
        "settlement",
        "control",
        "client",
        "monitor"
      ]) {
        const text = await readFile(
          join(
            repository,
            `ops/anime-arena/yunipals-anime-arena-${service}.service`
          ),
          "utf8"
        );
        if (text.includes("/openrouter.env"))
          throw new Error(`Unexpected Claude credential access: ${service}.`);
      }
    }
  );
  await verify("Built anime entrypoints", async () => {
    for (const name of [
      "arena-anime-media",
      "arena-anime-monitor",
      "arena-anime-deployment",
      "arena-anime-studio",
      "arena-anime-rehearsal",
      "arena-capacity"
    ]) {
      const path = `apps/yunipals-market-api/dist/${name}.mjs`;
      const bytes = await readFile(join(repository, path));
      if (
        name === "arena-anime-media" &&
        !bytes.includes(Buffer.from("claude-choreography/v5"))
      )
        throw new Error("Media build predates the Claude integration.");
      files[path] = hash(bytes);
    }
  });
  const deployment = await json(
    join(repository, "docs/arena/anime-deployment.json")
  );
  const launchBlockers = animeLaunchBlockers(deployment);
  return {
    version: "anime-release-review/v1",
    readyForDeploymentReview: checks.every((c) => c.passed),
    readyForPublicLaunch:
      checks.every((c) => c.passed) && launchBlockers.length === 0,
    engine: engine
      ? {
          version: engine.version,
          sha256: engine.sha256,
          chromium: engine.chromium
        }
      : null,
    recipeSha256: recipe?.sha256 ?? null,
    checks,
    launchBlockers,
    files
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2);
  if (
    args.some(
      (v, i) =>
        v !== "--launch" && v !== "--output" && args[i - 1] !== "--output"
    )
  )
    throw new Error(
      "Usage: node scripts/anime/preflight.mjs [--launch] [--output REPORT.json]"
    );
  const report = await animeReleasePreflight();
  const output = args.indexOf("--output");
  if (output >= 0) {
    if (!args[output + 1]) throw new Error("Report path is required.");
    await writeFile(
      resolve(args[output + 1]),
      JSON.stringify(report, null, 2) + "\n"
    );
  }
  console.log(JSON.stringify(report, null, 2));
  if (
    !report.readyForDeploymentReview ||
    (args.includes("--launch") && !report.readyForPublicLaunch)
  )
    process.exitCode = 1;
}
