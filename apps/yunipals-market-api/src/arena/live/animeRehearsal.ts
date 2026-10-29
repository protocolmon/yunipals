/** Private, offchain model comparison. No wallet, database or production source writes. */
import { randomBytes, randomUUID, randomInt, createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  readdir,
  rm,
  cp
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { animeRepository } from "./animeRepository";
import { canonicalJson, sha256 } from "../draw";
import type { FrozenInput } from "../types";
import { loadLiveArenaCatalog } from "./catalog";
import { productionValidator } from "./adjudication";
import { refereeRequest, refereeCandidate } from "./refereeApi";
import {
  exportAnimeTournament,
  offlineAnimeTool,
  probeAnimeFilm
} from "./animeMedia";
import {
  directTournament,
  type AnimeMatch
} from "../../../../yunipals-anime-engine/src/director";
import { animeFighterName } from "../../../../yunipals-anime-engine/src/fighterNames.js";
import {
  animeDirectorRequest,
  applyAnimeProviderDirection,
  ANIME_DIRECTOR_POLICY,
  type AnimeDirectionInput
} from "./animeDirection";
import type { LiveFrozenInput } from "./input";
import type { AnimeKnownKit } from "@protopals/yunipals-market-core/anime";

const root = animeRepository();
const engine = join(root, "apps/yunipals-anime-engine");
const json = async <T = Record<string, unknown>>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T;
const bytesHash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
async function save(path: string, value: unknown, immutable = false) {
  if (immutable) {
    try {
      if (canonicalJson(await json(path)) !== canonicalJson(value))
        throw new Error("Rehearsal inputs and requests are immutable.");
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    ...(immutable ? { flag: "wx" } : {})
  });
}
const variants = {
  haiku: "anthropic/claude-haiku-5.5",
  opus: "anthropic/claude-opus-5.5"
} as const;
type Variant = keyof typeof variants;
type PaidReceipt = {
  state: string;
  generationId?: string;
  providerId?: string;
  requestId: string;
  model: string;
  actualCostUsd: number | null;
  usage: Record<string, unknown> | null;
  elapsedSeconds?: number;
  usageBasedCostUsd?: number;
  costBasis?: string;
};
type Completion = {
  model: string;
  choices: Array<{
    finish_reason: string;
    message: { content: string; tool_calls?: unknown[] };
  }>;
};
async function candidate(job: string, task: string, model: string) {
  const receipt = await json<PaidReceipt>(
    join(job, "tasks", task, "receipt.json")
  );
  if (
    receipt.state !== "completed" ||
    typeof receipt.actualCostUsd !== "number"
  )
    throw new Error(
      `${task} needs a completed, accounted original generation.`
    );
  const response = await json<Completion>(
    join(job, "tasks", task, "response.json")
  );
  if (
    response.model !== model ||
    response.choices?.length !== 1 ||
    response.choices[0]?.finish_reason !== "stop" ||
    response.choices[0]?.message.tool_calls?.length
  )
    throw new Error(`${task} returned an unsupported completion.`);
  return {
    value: JSON.parse(response.choices[0].message.content) as unknown,
    receipt
  };
}
async function task(
  job: string,
  name: string,
  model: string,
  reservedMicrousd: number,
  body: Record<string, unknown>
) {
  const folder = join(job, "tasks", name);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await save(join(folder, "request.json"), body, true);
  await save(
    join(folder, "task.json"),
    {
      version: "anime-rehearsal-task/v1",
      name,
      model,
      reservedMicrousd,
      requestId: sha256(canonicalJson([name, body])),
      requestSha256: bytesHash(await readFile(join(folder, "request.json"))),
      rehearsal: true
    },
    true
  );
}
async function prepareChoreography(job: string) {
  await mkdir(job, { recursive: true, mode: 0o700 });
  const source = join(root, "apps/yunipals-market-api/src/arena/live/fixtures");
  const input = await json<FrozenInput>(join(source, "pilot-input.json"));
  const outcome = await json<{ matches: AnimeMatch[]; championId: string }>(
    join(source, "pilot-outcome.json")
  );
  const validation = await productionValidator(root)(input, outcome);
  if (!validation.valid)
    throw new Error("Manual reference combat failed validation.");
  const fixture = (await import(
    pathToFileURL(join(engine, "fixture.mjs")).href
  )) as { prepareFixture: (job: string) => Promise<void> };
  const staging = join(job, "fixture-build");
  await fixture.prepareFixture(staging);
  await cp(join(staging, "assets"), join(job, "fixture-assets"), {
    recursive: true
  });
  const historical = await json<AnimeDirectionInput["tournament"]>(
    join(engine, "fixtures/tournament.json")
  );
  if (
    canonicalJson(historical.matches) !==
    canonicalJson(
      outcome.matches.map((m) => ({
        id: m.id,
        fighterIds: m.fighterIds,
        winnerId: m.winnerId,
        loserId: m.loserId,
        verdict: m.verdict,
        verdictSeconds: m.verdictSeconds,
        settledSeconds: m.settledSeconds,
        whyWinner: m.whyWinner,
        events: m.events
      }))
    )
  )
    throw new Error("Manual reference events differ from the frozen outcome.");
  const tournament = exportAnimeTournament(
    input as unknown as LiveFrozenInput,
    outcome
  );
  const fighters = await json<
    Record<
      string,
      { manifest: { look: { attackKind: string }; kits?: AnimeKnownKit[] } }
    >
  >(join(job, "fixture-assets/fighters.json"));
  const strategies = Object.fromEntries(
    input.strategies.map((s) => [s.fighterId, s.text])
  );
  const direction: AnimeDirectionInput = {
    tournament,
    strategies,
    loadouts: Object.fromEntries(
      Object.entries(fighters).map(([id, f]) => [id, f.manifest.kits ?? []])
    ),
    choreography: directTournament(
      tournament,
      Object.fromEntries(
        Object.entries(fighters).map(([id, f]) => [id, f.manifest.look])
      ),
      strategies
    )
  };
  for (const [name, value] of Object.entries({
    "input.json": input,
    "outcome.json": outcome,
    "referee-validation.json": validation,
    "direction-input.json": direction,
    "reference-choreography.json": await json(
      join(engine, "fixtures/choreography.json")
    )
  }))
    await save(join(job, name), value, true);
  await save(
    join(job, "authorization.json"),
    {
      version: "anime-choreography-review/v1",
      expectedTasks: ["opus"],
      maxSpendMicrousd: 800000,
      inputSha256: sha256(canonicalJson(input)),
      outcomeSha256: sha256(canonicalJson(outcome)),
      directorPolicy: ANIME_DIRECTOR_POLICY,
      refereeReused: true,
      artworkReused: true,
      mainnetTransactions: 0
    },
    true
  );
  await task(job, "opus", variants.opus, 800000, {
    ...animeDirectorRequest(direction),
    stream: true
  });
  await rm(staging, { recursive: true });
  console.log(
    JSON.stringify({
      state: "manual-reference-frozen",
      matches: outcome.matches.map((m) => ({
        id: m.id,
        events: m.events.length
      })),
      maxAdditionalCostUsd: 0.8
    })
  );
}
async function prepare(job: string, production = false) {
  await mkdir(job, { recursive: true, mode: 0o700 });
  try {
    await readFile(join(job, "input.json"));
    await readFile(join(job, "tasks/referee/task.json"));
    console.log("Frozen rehearsal input retained.");
    return;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const source = await json<FrozenInput>(
    join(
      root,
      "apps/yunipals-market-api/src/arena/live/fixtures/pilot-input.json"
    )
  );
  const catalog = loadLiveArenaCatalog(root);
  const strategies: Record<string, string> = production
    ? {
        cedar:
          "Open immediately with a light green forehoof vine lash at the real torso. After recovering, track the target and use a heavy lash when its attack or defense has committed. Repeat after each recovery instead of waiting indefinitely. If free when a projectile releases, sidestep across dry stone; otherwise brace if guarding is still legal. Keep all four hooves on the floor and aim upward at a flyer's actual flank, never leap or invent cover.",
        zephyr:
          "Begin with a short low-flight angle change, then send a heavy amber starburst from the forepaws at the opponent's actual chest. Bank across an incoming attack only while free to defend. Answer a miss with a light starburst, recover fully and attack again from the new angle. Keep butterfly wings moving above the channels, within the allowed flight height. Do not wait for the opponent to make the first attack or claim flight makes a hit impossible.",
        bastion:
          "Initiate with a light mouth-fired water jet at the opponent's actual body height. Slide straight along dry central stone while tracking the response. After full recovery, fire a heavy water hammer when the target is committed, then continue short jets after each recovery. If free before an impact, turn the shell into a physical guard. Water can wet the actual splash area but a puddle alone cannot hurt or topple the opponent. Keep flippers and belly low.",
        elrond:
          "Start in low controlled flight and launch a light blue mouth orb at the real torso. Follow it on a shallow curve. After recovery, if the opponent commits to an attack, drive a wing-assisted shoulder check into the actual flank at matching height and pass clear with claws tucked. If free when a return shot releases, bank sideways, then resume the orb-and-shoulder sequence after recovery. Do not land, grab, hold, attack while recovering or rely on imaginary terrain."
      }
    : {
        cedar:
          "Keep all four hooves on the arena floor. Step sideways during an opponent's long windup, then answer with a compact vine lash as they recover. Guard if a shot is already too close to evade. Save energy for a late second strike; never chase a flying opponent upward.",
        zephyr:
          "Stay just above the arena floor and move across the opponent's aim. Use a quick star burst after their first attack passes. If they rush, defend once and counter from the side instead of trading heavy blows. Finish with the shortest clean opening you can find.",
        bastion:
          "Keep your shell between you and the attacker. Use one short water jet to force a reaction, then a heavier jet when the opponent is recovering. Guard incoming fire when stepping away would be too late. Do not waste a final attack if the clock is about to expire.",
        elrond:
          "Use low controlled flight and watch the opponent's recovery. Release a small arc orb from the side after a clear miss, then reposition before another attack. Against a guarded foe, change the angle rather than inventing a stronger power. Protect your remaining health near the deadline."
      };
  const ids = ["cedar", "zephyr", "bastion", "elrond"];
  if (production)
    for (let i = ids.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
  const input = {
    ...source,
    version: "anime-private-rehearsal/v1",
    mode: "private-offchain-rehearsal",
    tournamentId: randomUUID(),
    rules: catalog.rules,
    draw: {
      mode: "private-rehearsal-randomness",
      word: `0x${randomBytes(32).toString("hex")}`,
      requestId: randomUUID(),
      algorithm: "no onchain draw; historical fixture arena"
    },
    roster: ids.map((id) => {
      const f = source.roster.find((f) => f.id === id)!;
      return { ...f, name: `${animeFighterName(f.species)} #${f.tokenId}` };
    }),
    semifinals: production
      ? [ids.slice(0, 2), ids.slice(2, 4)]
      : [
          ["cedar", "zephyr"],
          ["bastion", "elrond"]
        ],
    strategies: ids.map((fighterId) => ({
      fighterId,
      text: strategies[fighterId]!
    }))
  };
  const inputSha256 = sha256(canonicalJson(input));
  const fixture = (await import(
    pathToFileURL(join(engine, "fixture.mjs")).href
  )) as { prepareFixture: (job: string) => Promise<void> };
  const staging = join(job, "fixture-build");
  await fixture.prepareFixture(staging);
  await cp(join(staging, "assets"), join(job, "fixture-assets"), {
    recursive: true
  });
  for (const file of ["tournament.json", "choreography.json"])
    await rm(join(job, "fixture-assets", file));
  await rm(staging, { recursive: true });
  await save(join(job, "input.json"), input, true);
  await save(
    join(job, "authorization.json"),
    {
      version: production
        ? "anime-production-rehearsal/v1"
        : "anime-private-rehearsal/v1",
      createdAt: new Date().toISOString(),
      inputSha256,
      maxSpendMicrousd: production ? 1500000 : 1520000,
      expectedTasks: production
        ? ["referee", "opus"]
        : ["referee", "haiku", "opus"],
      ...(production
        ? {
            providers: { referee: "openai-responses", opus: "openrouter" },
            refereeReused: false,
            directorReused: false
          }
        : {}),
      artwork:
        "historical fixture art reused; not approved Base launch fighters",
      mainnetTransactions: 0
    },
    true
  );
  const priority = input.roster
    .map((f) => f.id)
    .sort((a, b) =>
      sha256(
        canonicalJson([
          "yunipals-arena/tie/v2",
          input.tournamentId,
          input.draw.word,
          a
        ])
      ).localeCompare(
        sha256(
          canonicalJson([
            "yunipals-arena/tie/v2",
            input.tournamentId,
            input.draw.word,
            b
          ])
        )
      )
    );
  const baseline = JSON.parse(canonicalJson(input)) as Record<
    string,
    unknown
  > & { pool: { entries?: unknown }; rules: { refereeInstructions?: unknown } };
  delete baseline.pool.entries;
  delete baseline.rules.refereeInstructions;
  baseline.sourceInputSha256 = inputSha256;
  if (production) {
    const body = refereeRequest(
      input.rules.refereeInstructions +
        "\nResolve this single tournament. Public tie priority: " +
        priority.join(", ") +
        ". Return schema JSON only.\nFROZEN INPUT\n",
      baseline,
      await json(join(root, "docs/arena/rules-v2/output-schema.json"))
    );
    await task(job, "referee", body.model, 700000, body);
    console.log(
      JSON.stringify({
        state: "fresh-production-input-frozen",
        inputSha256,
        plannedMaximumUsd: 1.5,
        providers: {
          referee: "direct OpenAI Responses",
          director: "OpenRouter Claude"
        },
        semifinals: input.semifinals
      })
    );
    return;
  }
  const body = {
    model: "openai/gpt-6.1-sol",
    stream: true,
    max_tokens: 32000,
    reasoning: { effort: "xhigh" },
    provider: {
      order: ["OpenAI"],
      allow_fallbacks: false,
      require_parameters: true,
      max_price: { prompt: 2.5, completion: 10 }
    },
    messages: [
      {
        role: "system",
        content:
          input.rules.refereeInstructions +
          "\nResolve this single tournament. Public tie priority: " +
          priority.join(", ") +
          ". Return schema JSON only.\nFROZEN INPUT\n"
      },
      { role: "user", content: canonicalJson(baseline) }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "arena_outcome",
        strict: true,
        schema: await json(join(root, "docs/arena/rules-v2/output-schema.json"))
      }
    }
  };
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > 120000)
    throw new Error("Rehearsal referee exceeds the approved request envelope.");
  await task(job, "referee", body.model, 700000, body);
  console.log(
    JSON.stringify({
      state: "prepared",
      inputSha256,
      privateRehearsal: true,
      plannedMaximumUsd: 1.52
    })
  );
}
async function acceptReferee(job: string, production = false) {
  const input = await json<FrozenInput>(join(job, "input.json"));
  let generated: { value: unknown; receipt: PaidReceipt };
  if (production) {
    const receipt = await json<PaidReceipt>(
      join(job, "tasks/referee/receipt.json")
    );
    const response = await json<Parameters<typeof refereeCandidate>[0]>(
      join(job, "tasks/referee/response.json")
    );
    if (
      receipt.state !== "completed" ||
      receipt.model !== "gpt-6.1-sol" ||
      typeof receipt.usageBasedCostUsd !== "number"
    )
      throw new Error(
        "Original production referee response or usage accounting is incomplete."
      );
    generated = { value: refereeCandidate(response), receipt };
  } else generated = await candidate(job, "referee", "openai/gpt-6.1-sol");
  const validation = await productionValidator(root)(input, generated.value);
  await save(join(job, "referee-validation.json"), validation);
  if (!validation.valid)
    throw new Error(
      "The original fresh referee result failed validation; no automatic reroll is allowed."
    );
  await save(join(job, "outcome.json"), generated.value, true);
  const outcome = generated.value as {
    matches: AnimeMatch[];
    championId: string;
  };
  const tournament = exportAnimeTournament(
    input as unknown as LiveFrozenInput,
    outcome
  );
  const looks = await json<
    Record<string, { manifest: { look: { attackKind: string } } }>
  >(join(job, "fixture-assets/fighters.json"));
  const direction: AnimeDirectionInput = {
    tournament,
    strategies: Object.fromEntries(
      input.strategies.map((s) => [s.fighterId, s.text])
    ),
    choreography: directTournament(
      tournament,
      Object.fromEntries(
        Object.entries(looks).map(([id, f]) => [id, f.manifest.look])
      ),
      Object.fromEntries(input.strategies.map((s) => [s.fighterId, s.text]))
    )
  };
  await save(join(job, "direction-input.json"), direction, true);
  if (production) {
    await task(
      job,
      "opus",
      variants.opus,
      800000,
      animeDirectorRequest(direction)
    );
    console.log(
      JSON.stringify({
        state: "fresh-production-referee-valid",
        events: outcome.matches.map((m) => ({
          id: m.id,
          events: m.events.length
        })),
        refereeCostFromUsageUsd: generated.receipt.usageBasedCostUsd,
        costBasis: generated.receipt.costBasis
      })
    );
    return;
  }
  const haiku = {
    ...animeDirectorRequest(direction),
    stream: true,
    model: variants.haiku,
    max_tokens: 4096,
    reasoning: { enabled: false },
    provider: {
      order: ["Anthropic"],
      allow_fallbacks: false,
      require_parameters: true,
      max_price: { prompt: 0.2, completion: 1 }
    }
  };
  await task(job, "haiku", variants.haiku, 20000, haiku);
  const opus: Record<string, unknown> = {
    ...haiku,
    model: variants.opus,
    max_tokens: 16384,
    reasoning: { effort: "low" },
    provider: {
      order: ["Anthropic"],
      allow_fallbacks: false,
      require_parameters: true,
      max_price: { prompt: 5, completion: 20 }
    }
  };
  await task(job, "opus", variants.opus, 800000, opus);
  console.log(
    JSON.stringify({
      state: "fresh-referee-valid",
      events: outcome.matches.reduce((sum, m) => sum + m.events.length, 0),
      actualRefereeCostUsd: generated.receipt.actualCostUsd
    })
  );
}
async function validateDirection(job: string, variant: Variant) {
  const direction = await json<AnimeDirectionInput>(
    join(job, "direction-input.json")
  );
  const generated = await candidate(job, variant, variants[variant]);
  let choreography;
  try {
    choreography = applyAnimeProviderDirection(direction, generated.value);
  } catch (e) {
    await save(join(job, `direction-${variant}-validation.json`), {
      valid: false,
      error: (e as Error).message
    });
    throw e;
  }
  await save(join(job, `direction-${variant}-validation.json`), {
    valid: true
  });
  return { direction, generated, choreography };
}
async function render(job: string, variant: Variant) {
  const { direction, generated, choreography } = await validateDirection(
    job,
    variant
  );
  const folder = join(job, "films", variant),
    assets = join(folder, "assets"),
    pub = join(folder, "public");
  await mkdir(assets, { recursive: true, mode: 0o700 });
  await mkdir(pub, { recursive: true, mode: 0o700 });
  for (const name of await readdir(join(job, "fixture-assets")))
    await copyFile(join(job, "fixture-assets", name), join(assets, name));
  await save(join(assets, "tournament.json"), direction.tournament);
  await save(join(assets, "choreography.json"), choreography);
  const chrome = process.env.ANIME_CHROME;
  if (!chrome) throw new Error("Pinned ANIME_CHROME is required.");
  const started = Date.now();
  await save(join(folder, "status.json"), {
    state: "rendering",
    startedAt: new Date().toISOString()
  });
  await offlineAnimeTool(
    process.execPath,
    [join(engine, "render.mjs"), folder],
    chrome
  );
  const music = join(
    root,
    "docs/islands/race-film-v4/audio/split-in-synapse-original.mp3"
  );
  await offlineAnimeTool("python3", [
    join(engine, "mix.py"),
    join(folder, "film.cues.json"),
    "-",
    join(folder, "sfx.wav")
  ]);
  await offlineAnimeTool("python3", [
    join(engine, "mix.py"),
    join(folder, "film.cues.json"),
    music,
    join(folder, "mix.wav")
  ]);
  for (const [audio, file] of [
    ["sfx.wav", "native-sfx.mp4"],
    ["mix.wav", "film.mp4"]
  ])
    await offlineAnimeTool("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      join(folder, "silent.mp4"),
      "-i",
      join(folder, audio!),
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      join(pub, file!)
    ]);
  const probe = await probeAnimeFilm(join(pub, "film.mp4"));
  const receipt = await json<{
    duration: number;
    chapters: Array<{ id: string; t: number; winnerAt: number }>;
    cues: Array<{ t: number; type: string }>;
  }>(join(folder, "render-receipt.json"));
  if (Math.abs(probe.duration - receipt.duration) > 0.1)
    throw new Error("Rehearsal film duration mismatch.");
  const auth = await json<{ version: string }>(join(job, "authorization.json"));
  const referenceReview = auth.version === "anime-choreography-review/v1";
  const referee = referenceReview
    ? {
        state: "reused",
        actualCostUsd: 0,
        model: "historical frozen referee output"
      }
    : await json<PaidReceipt>(join(job, "tasks/referee/receipt.json"));
  const usageBased =
    "usageBasedCostUsd" in referee &&
    typeof referee.usageBasedCostUsd === "number";
  if (auth.version === "anime-production-rehearsal/v1" && !usageBased)
    throw new Error("Production-route referee usage accounting is missing.");
  const inferenceCost =
    (usageBased ? referee.usageBasedCostUsd! : (referee.actualCostUsd ?? 0)) +
    (generated.receipt.actualCostUsd ?? 0);
  await save(join(pub, "input.json"), {
    rehearsal: true,
    input: await json(join(job, "input.json"))
  });
  await save(join(pub, "outcome.json"), {
    rehearsal: true,
    outcome: await json(join(job, "outcome.json")),
    validation: await json(join(job, "referee-validation.json"))
  });
  await save(join(pub, "prompts.json"), {
    rehearsal: true,
    tournament: direction.tournament,
    choreography,
    directorModel: variants[variant]
  });
  await save(join(pub, "film.json"), {
    rehearsal: true,
    ...receipt,
    probe,
    sha256: bytesHash(await readFile(join(pub, "film.mp4"))),
    renderWallMs: Date.now() - started
  });
  await save(join(pub, "receipts.json"), {
    rehearsal: true,
    referee,
    director: generated.receipt,
    inferenceCostUsd: inferenceCost,
    costBasis: usageBased
      ? "OpenAI reported usage at published rates plus OpenRouter reported charge; not invoice-reconciled"
      : "provider-reported charges",
    artworkGenerationCostUsd: 0,
    artworkReused: true,
    videoModelCalls: 0
  });
  await save(join(pub, "media-policy.json"), {
    rehearsal: true,
    model: variants[variant],
    directorPolicy: ANIME_DIRECTOR_POLICY,
    refereeReused: referenceReview,
    offchain: true,
    historicalArtwork: true,
    noMainnetTransactions: true
  });
  await writeFile(
    join(pub, "credits.txt"),
    `Private Yunipals rehearsal; historical fixture artwork reused. ${referenceReview ? "Original manual battle referee output reused; new Claude choreography." : "New referee and director output."}\nMusic: "Split In Synapse" by Kevin MacLeod (incompetech.com), CC BY 4.0.\nhttps://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100703\nhttps://creativecommons.org/licenses/by/4.0/\nMusic excerpted, looped and mixed with synthesized SFX. Fonts: Bangers and Russo One, SIL OFL.\n`
  );
  const proof = join(folder, "proof");
  await mkdir(proof, { recursive: true });
  for (const [name, t] of [
    ["ready", receipt.chapters[0]!.t + 7.7],
    ["cutin", (receipt.cues.find((c) => c.type === "cutin")?.t ?? 15) + 0.5]
  ] as const)
    await offlineAnimeTool("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(t),
      "-i",
      join(pub, "film.mp4"),
      "-frames:v",
      "1",
      join(proof, `${name}.png`)
    ]);
  await save(join(folder, "status.json"), {
    state: "complete",
    renderWallMs: Date.now() - started,
    duration: receipt.duration
  });
  console.log(
    JSON.stringify({
      state: "film-complete",
      variant,
      duration: receipt.duration,
      renderWallMs: Date.now() - started,
      inferenceCostUsd: inferenceCost
    })
  );
}
async function summary(job: string) {
  const authorization = await json<{ version: string }>(
    join(job, "authorization.json")
  );
  if (authorization.version === "anime-production-rehearsal/v1") {
    const referee = await json<PaidReceipt>(
      join(job, "tasks/referee/receipt.json")
    );
    const director = await json<PaidReceipt>(
      join(job, "tasks/opus/receipt.json")
    );
    const direction = await json<AnimeDirectionInput>(
      join(job, "direction-input.json")
    );
    if (
      referee.state !== "completed" ||
      director.state !== "completed" ||
      typeof referee.usageBasedCostUsd !== "number" ||
      typeof director.actualCostUsd !== "number"
    )
      throw new Error("Production-route rehearsal accounting is incomplete.");
    const report = {
      version: "anime-production-rehearsal-result/v1",
      inputSha256: sha256(canonicalJson(await json(join(job, "input.json")))),
      outcomeSha256: sha256(
        canonicalJson(await json(join(job, "outcome.json")))
      ),
      referee,
      director,
      film: await json(join(job, "films/opus/public/film.json")),
      refereeValidation: await json(join(job, "referee-validation.json")),
      directionValidation: await json(
        join(job, "direction-opus-validation.json")
      ),
      attackCounts: direction.tournament.matches.map((m) => ({
        id: m.id,
        events: m.events.length
      })),
      totalInferenceCostUsd: referee.usageBasedCostUsd + director.actualCostUsd,
      costBasis:
        "OpenAI reported usage at published rates plus OpenRouter reported USD charge; not invoice-reconciled",
      refereeReused: false,
      directorReused: false,
      artworkReused: true,
      mainnetTransactions: 0
    };
    await save(join(job, "summary.json"), report);
    console.log(JSON.stringify(report));
    return;
  }
  if (authorization.version === "anime-choreography-review/v1") {
    const receipt = await json<PaidReceipt>(
      join(job, "tasks/opus/receipt.json")
    );
    const direction = await json<AnimeDirectionInput>(
      join(job, "direction-input.json")
    );
    if (receipt.state !== "completed")
      throw new Error("Original choreography request needs recovery.");
    const report = {
      version: "anime-choreography-review-result/v1",
      directorPolicy: ANIME_DIRECTOR_POLICY,
      receipt,
      film: await json(join(job, "films/opus/public/film.json")),
      validation: await json(join(job, "direction-opus-validation.json")),
      originalAttackCounts: direction.tournament.matches.map((m) => ({
        id: m.id,
        events: m.events.length
      })),
      additionalInferenceCostUsd: receipt.actualCostUsd,
      refereeReused: true,
      artworkReused: true,
      mainnetTransactions: 0
    };
    await save(join(job, "summary.json"), report);
    console.log(JSON.stringify(report));
    return;
  }
  const costs: Record<string, PaidReceipt> = {};
  for (const name of ["referee", "haiku", "opus"])
    costs[name] = await json<PaidReceipt>(
      join(job, "tasks", name, "receipt.json")
    );
  if (
    Object.values(costs).some(
      (r) => r.state !== "completed" || typeof r.actualCostUsd !== "number"
    )
  )
    throw new Error("Rehearsal accounting is incomplete.");
  const films: Record<string, unknown> = {};
  const directionValidation: Record<string, unknown> = {};
  for (const variant of Object.keys(variants)) {
    const validation = await json<{ valid: boolean; error?: string }>(
      join(job, `direction-${variant}-validation.json`)
    );
    directionValidation[variant] = validation;
    films[variant] = validation.valid
      ? await json(join(job, "films", variant, "public/film.json"))
      : null;
  }
  const report = {
    version: "anime-private-rehearsal-result/v1",
    completedAt: new Date().toISOString(),
    inputSha256: sha256(canonicalJson(await json(join(job, "input.json")))),
    outcomeSha256: sha256(canonicalJson(await json(join(job, "outcome.json")))),
    validation: await json(join(job, "referee-validation.json")),
    costs,
    totalExperimentCostUsd: Object.values(costs).reduce(
      (sum, r) => sum + r.actualCostUsd!,
      0
    ),
    haikuAttemptCostUsd:
      costs.referee!.actualCostUsd! + costs.haiku!.actualCostUsd!,
    opusAttemptCostUsd:
      costs.referee!.actualCostUsd! + costs.opus!.actualCostUsd!,
    directionValidation,
    films,
    artworkReused: true,
    mainnetTransactions: 0,
    productionRefereeProviderChanged: false
  };
  await save(join(job, "summary.json"), report);
  console.log(JSON.stringify(report, null, 2));
}
const [operation, rawJob, variant] = process.argv.slice(2);
if (
  !rawJob ||
  ![
    "prepare",
    "prepare-choreography",
    "prepare-production",
    "accept-referee",
    "accept-production-referee",
    "validate",
    "render",
    "summary"
  ].includes(operation ?? "")
)
  throw new Error(
    "Usage: arena-anime-rehearsal prepare|prepare-choreography|accept-referee|validate|render|summary PRIVATE_JOB [haiku|opus]"
  );
const job = resolve(rawJob);
if (
  !job.startsWith("/var/lib/yunipals-anime-arena/rehearsals/") &&
  !job.startsWith("/tmp/")
)
  throw new Error("Use an isolated private rehearsal directory.");
if (operation === "prepare") await prepare(job);
else if (operation === "prepare-production") await prepare(job, true);
else if (operation === "prepare-choreography") await prepareChoreography(job);
else if (operation === "accept-referee") await acceptReferee(job);
else if (operation === "accept-production-referee")
  await acceptReferee(job, true);
else if (operation === "render" || operation === "validate") {
  if (!variant || !(variant in variants))
    throw new Error("Choose haiku or opus.");
  if (operation === "render") await render(job, variant as Variant);
  else {
    const { direction } = await validateDirection(job, variant as Variant);
    console.log(
      JSON.stringify({
        valid: true,
        directorPolicy: ANIME_DIRECTOR_POLICY,
        attackCounts: direction.tournament.matches.map((m) => m.events.length)
      })
    );
  }
} else await summary(job);
