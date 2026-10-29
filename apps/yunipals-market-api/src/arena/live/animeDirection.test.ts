import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalJson } from "../draw";
import {
  directTournament,
  type AnimeTournament
} from "../../../../yunipals-anime-engine/src/director";
import {
  animeDirectorRequest,
  applyAnimeDirection,
  applyAnimeProviderDirection,
  type AnimeDirection,
  type AnimeDirectionInput
} from "./animeDirection";
import {
  openRouterCreditMicrousd,
  measureOpenRouterCredit
} from "./animeDirectorApi";
import {
  manualAnimeDirection,
  fixtureProviderDirection
} from "./animeDirectionFixture";

function fixture() {
  const tournament = JSON.parse(
    readFileSync(
      new URL(
        "../../../../yunipals-anime-engine/fixtures/tournament.json",
        import.meta.url
      ),
      "utf8"
    )
  ) as AnimeTournament;
  const strategies = Object.fromEntries(
    Object.keys(tournament.fighters).map((id) => [
      id,
      "Hold your ground. Strike when they recover!"
    ])
  );
  const choreography = directTournament(
    tournament,
    Object.fromEntries(
      Object.keys(strategies).map((id) => [id, { attackKind: "orb" }])
    ),
    strategies
  );
  const input: AnimeDirectionInput = { tournament, strategies, choreography };
  const direction = manualAnimeDirection(input);
  for (const attack of direction.attacks) attack.name = "MOON STRIKE";
  for (const cutin of direction.cutins) cutin.title = "MAKE YOUR MOVE!";
  return { input, direction };
}
test("Claude restores manual movement and body attacks without altering frozen combat", () => {
  const { input, direction } = fixture();
  const before = structuredClone(input);
  const result = applyAnimeDirection(input, direction);
  assert.deepEqual(input, before);
  for (const [id, c] of Object.entries(result)) {
    assert.equal(c.result, before.choreography[id]!.result);
    assert.ok(Object.values(c.names).every((v) => v === "MOON STRIKE"));
    c.cutins.forEach((ci, i) => {
      const old = before.choreography[id]!.cutins[i]!;
      assert.equal(
        ci.at,
        direction.cutins.find((v) => v.matchId === id && v.index === i)!.at
      );
      assert.equal(ci.type, old.type);
      assert.equal(ci.who, old.who);
      assert.equal(ci.title, "MAKE YOUR MOVE!");
    });
  }
  assert.ok(result.SF1!.pos.cedar!.depth!.length > 1);
  assert.ok(result.SF2!.pos.elrond!.y!.length > 1);
  assert.ok(result.SF2!.pos.elrond!.face!.some((k) => k[1] === -1));
  assert.equal(result.SF2!.kinds["SF2-3"], "dash");
  assert.equal(result.SF2!.kinds["SF2-5"], "dash");
  assert.notDeepEqual(result.SF2!.pos, before.choreography.SF2!.pos);
});
test("Claude labels reject omitted, duplicated, foreign or oversized battle data", () => {
  const { input, direction } = fixture();
  for (const mutate of [
    (d: AnimeDirection) => d.attacks.pop(),
    (d: AnimeDirection) => d.attacks.push(d.attacks[0]!),
    (d: AnimeDirection) => (d.attacks[0]!.eventId = "unknown"),
    (d: AnimeDirection) => (d.attacks[0]!.name = "TOO MANY WORDS"),
    (d: AnimeDirection) => (d.attacks[0]!.name = "x".repeat(25)),
    (d: AnimeDirection) => (d.attacks[0]!.name = "BROKEN\nLABEL"),
    (d: AnimeDirection) => (d.cutins[0]!.index = 999),
    (d: AnimeDirection) =>
      (d.cutins[0]!.quotes[0]!.text = "Invented dialogue."),
    (d: AnimeDirection) => (d.cutins[0]!.quotes[0]!.text = ""),
    (d: AnimeDirection) => (d.cutins[0]!.quotes[0]!.text = "old your ground."),
    (d: AnimeDirection) => (d.cutins[0]!.quotes[0]!.text = "Hold your grou"),
    (d: AnimeDirection) => (d.cutins[0]!.quotes[0]!.fighterId = "unknown"),
    (d: AnimeDirection) => d.cutins[0]!.quotes.pop(),
    (d: AnimeDirection) => Object.assign(d.attacks[0]!, { damage: 99 }),
    (d: AnimeDirection) => Object.assign(d, { championId: "unknown" })
  ]) {
    const changed = structuredClone(direction);
    mutate(changed);
    assert.throws(() => applyAnimeDirection(input, changed));
  }
});
test("motion and cut-ins reject missing fighters, impossible paths, fake contact and hidden combat edits", () => {
  const { input, direction } = fixture();
  for (const mutate of [
    (d: AnimeDirection) => d.motion.pop(),
    (d: AnimeDirection) => d.motion.push(d.motion[0]!),
    (d: AnimeDirection) => (d.motion[0]!.fighterId = "unknown"),
    (d: AnimeDirection) => (d.motion[0]!.x[0]!.value = 500),
    (d: AnimeDirection) => (d.motion[0]!.x[1]!.t = 0),
    (d: AnimeDirection) => (d.motion[0]!.x[1]!.value = 1300),
    (d: AnimeDirection) => (d.motion[0]!.x[1]!.t = 99),
    (d: AnimeDirection) => (d.motion[0]!.x[1]!.value = NaN),
    (d: AnimeDirection) => (d.motion[0]!.y = [{ t: 0, value: 415 }]),
    (d: AnimeDirection) => (d.motion[0]!.face = [{ t: 0, value: 0 }]),
    (d: AnimeDirection) => {
      const p = d.motion.find(
        (m) => m.matchId === "SF1" && m.fighterId === "cedar"
      )!;
      p.depth = [];
      p.x = [{ t: 0, value: 900 }];
    },
    (d: AnimeDirection) => {
      const p = d.motion.find(
        (m) => m.matchId === "SF2" && m.fighterId === "elrond"
      )!;
      p.x = [{ t: 0, value: 380 }];
    },
    (d: AnimeDirection) => (d.cutins[0]!.at = 0),
    (d: AnimeDirection) => (d.cutins[1]!.at = 99),
    (d: AnimeDirection) => Object.assign(d.motion[0]!, { damage: 99 }),
    (d: AnimeDirection) => (d.attacks[0]!.kind = "vine")
  ]) {
    const changed = structuredClone(direction);
    mutate(changed);
    assert.throws(() => applyAnimeDirection(input, changed));
  }
});
test("Claude request pins its model, provider, output schema, price and input envelope", () => {
  const { input } = fixture();
  const request = animeDirectorRequest(input);
  assert.equal(request.model, "anthropic/claude-opus-5.5");
  assert.equal(request.max_tokens, 16384);
  assert.deepEqual(request.reasoning, { effort: "low" });
  assert.deepEqual(request.provider.max_price, { prompt: 5, completion: 20 });
  assert.equal(request.provider.allow_fallbacks, false);
  assert.equal(request.provider.require_parameters, true);
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(
    request.response_format.json_schema.name,
    "anime_choreography_v4"
  );
  // PostgreSQL jsonb can reorder object keys in the frozen input. Required-key
  // arrays must remain stable when the policy is reconstructed after a restart.
  assert.equal(
    canonicalJson(request),
    canonicalJson(animeDirectorRequest(JSON.parse(canonicalJson(input))))
  );
  input.strategies[Object.keys(input.strategies)[0]!] = "x".repeat(60000);
  assert.throws(() => animeDirectorRequest(input), /envelope/);
});
test("the recorded automated choreography retains all manual battle exchanges and body checks", () => {
  const { input } = fixture();
  const original = JSON.parse(
    readFileSync(
      new URL("./fixtures/pilot-input.json", import.meta.url),
      "utf8"
    )
  ) as { strategies: Array<{ fighterId: string; text: string }> };
  input.strategies = Object.fromEntries(
    original.strategies.map((s) => [s.fighterId, s.text])
  );
  input.choreography = directTournament(
    input.tournament,
    {
      cedar: { attackKind: "vine" },
      zephyr: { attackKind: "star" },
      bastion: { attackKind: "jet" },
      elrond: { attackKind: "orb" }
    },
    input.strategies
  );
  const read = (file: string) =>
    JSON.parse(
      readFileSync(
        new URL(
          `../../../../yunipals-anime-engine/fixtures/${file}`,
          import.meta.url
        ),
        "utf8"
      )
    );
  const before = structuredClone(input.tournament);
  const result = applyAnimeDirection(input, read("automated-direction.json"));
  assert.deepEqual(result, read("automated-choreography.json"));
  assert.deepEqual(input.tournament, before);
  assert.deepEqual(
    input.tournament.matches.map((m) => m.events.length),
    [5, 5, 6]
  );
  assert.equal(result.SF2!.kinds["SF2-3"], "dash");
  assert.equal(result.SF2!.kinds["SF2-5"], "dash");
  assert.ok(result.SF2!.pos.zephyr!.y!.some((k) => k[1] !== 415));
});
test("OpenRouter funding respects both current account credit and key allowance", () => {
  const account = { data: { total_credits: 10, total_usage: 3 } };
  assert.equal(
    openRouterCreditMicrousd(account, { data: { limit_remaining: 2 } }),
    2000000
  );
  assert.equal(
    openRouterCreditMicrousd(account, { data: { limit_remaining: null } }),
    7000000
  );
  assert.equal(
    openRouterCreditMicrousd(
      { data: { total_credits: 1, total_usage: 2 } },
      { data: { limit_remaining: null } }
    ),
    0
  );
  for (const value of [
    {},
    { data: {} },
    { data: { limit_remaining: -1 } },
    { data: { limit_remaining: NaN } },
    { data: { limit_remaining: null, disabled: true } },
    { data: { limit_remaining: null, expires_at: "invalid date" } },
    { data: { limit_remaining: null, expires_at: "2020-01-01T00:00:00Z" } }
  ])
    assert.throws(() => openRouterCreditMicrousd(account, value));
});
test("account checks never log or retain provider metadata and propagate failed checks", async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (url) => {
    requests.push(String(url));
    return Response.json(
      String(url).endsWith("/key")
        ? { data: { label: "private metadata", limit_remaining: 0.03 } }
        : { data: { total_credits: 10, total_usage: 2 } }
    );
  };
  assert.equal(await measureOpenRouterCredit("not-a-live-key", fetcher), 30000);
  assert.equal(requests.length, 2);
  await assert.rejects(
    measureOpenRouterCredit(
      "not-a-live-key",
      async () => new Response(null, { status: 401 })
    ),
    /funding/
  );
});

test("provider schema and validation require every final attack and cut-in", () => {
  const { input, direction } = fixture();
  const request = animeDirectorRequest(input);
  const shape = (v: unknown) =>
    v as { required: string[]; properties: Record<string, unknown> };
  const matches = shape(
    request.response_format.json_schema.schema.properties.matches
  );
  assert.deepEqual(matches.required, ["FINAL", "SF1", "SF2"]);
  for (const match of input.tournament.matches) {
    const body = shape(matches.properties[match.id]);
    assert.deepEqual(body.required, ["attacks", "cutins", "motion"]);
  }
  const wire = fixtureProviderDirection(input, direction);
  assert.deepEqual(
    applyAnimeProviderDirection(input, wire),
    applyAnimeDirection(input, direction)
  );
  for (const mutate of [
    (v: typeof wire) => delete v.matches.FINAL,
    (v: typeof wire) => (v.matches.FINAL!.attacks = "[]"),
    (v: typeof wire) =>
      (v.matches.SF1!.attacks = JSON.stringify(
        JSON.parse(v.matches.SF1!.attacks).slice(1)
      )),
    (v: typeof wire) => (v.matches.SF2!.motion = "[]"),
    (v: typeof wire) => (v.matches.SF2!.motion = "invalid JSON"),
    (v: typeof wire) => (v.matches.SF2!.motion = "{}"),
    (v: typeof wire) =>
      (v.matches.SF2!.motion = '[{"fighterId":"elrond","x":[]}]'),
    (v: typeof wire) => (v.matches.FINAL!.cutins = "[]")
  ]) {
    const changed = structuredClone(wire);
    mutate(changed);
    assert.throws(() => applyAnimeProviderDirection(input, changed));
  }
  assert.throws(
    () => applyAnimeProviderDirection(input, direction),
    /unsupported fields|version/i
  );
});
