import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { animeFighterName } from "./fighterNames.js";
import { resolveAnimeKit } from "./kitPolicy.js";
import {
  directTournament,
  strategyQuote,
  ATTACK_NAMES,
  type AnimeTournament
} from "./director.ts";
const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/tournament.json", import.meta.url), "utf8")
) as AnimeTournament;
test("kits resolve by frozen name, compatible loadout order and validated explicit selection", () => {
  const kits = [
    { id: "thorn-volley", name: "Thorn Volley", kind: "projectile" as const },
    { id: "vine-lash", name: "Vine Lash", kind: "strike" as const },
    { id: "leaf-shot", name: "Leaf Shot", kind: "projectile" as const }
  ];
  assert.equal(resolveAnimeKit("leaf shot", "star", kits)?.id, "leaf-shot");
  assert.equal(
    resolveAnimeKit("Unknown", "orb", kits, null)?.id,
    "thorn-volley"
  );
  assert.equal(resolveAnimeKit("Vine Lash", "vine", kits)?.id, "vine-lash");
  assert.equal(resolveAnimeKit("Unknown", "dash", kits), undefined);
  assert.equal(resolveAnimeKit("Unknown", "unknown", kits), undefined);
  assert.equal(
    resolveAnimeKit("Unknown", "jet", kits, "leaf-shot")?.id,
    "leaf-shot"
  );
  assert.throws(
    () => resolveAnimeKit("Unknown", "star", kits, "foreign"),
    /loadout/
  );
  assert.throws(
    () => resolveAnimeKit("Unknown", "dash", kits, "vine-lash"),
    /compatible/
  );
});
test("staging is deterministic and cannot alter outcomes", () => {
  const before = JSON.stringify(fixture);
  const looks = Object.fromEntries(
    Object.keys(fixture.fighters).map((id) => [id, { attackKind: "orb" }])
  );
  assert.deepEqual(
    directTournament(fixture, looks, {}),
    directTournament(fixture, looks, {})
  );
  assert.equal(JSON.stringify(fixture), before);
  assert.equal(Object.keys(directTournament(fixture, looks, {})).length, 3);
});
test("named kits select the matching presentation even when the species default uses another effect", () => {
  const t = structuredClone(fixture),
    e = t.matches[0]!.events[0]!;
  e.attackName = "Thorn Volley";
  const before = JSON.stringify(t);
  const looks = Object.fromEntries(
    Object.keys(t.fighters).map((id) => [id, { attackKind: "vine" }])
  );
  const result = directTournament(
    t,
    looks,
    {},
    {
      [e.actorId]: [
        { id: "thorn-volley", name: "Thorn Volley", kind: "projectile" }
      ]
    }
  );
  const c = result[t.matches[0]!.id]!;
  assert.equal(c.kinds[e.id], "orb");
  assert.equal(c.kits![e.id], "thorn-volley");
  assert.equal(c.names[e.id], "THORN VOLLEY");
  assert.equal(JSON.stringify(t), before);
});
test("quotes are verbatim and attack names have at most two words", () => {
  const text = "Move left. Then strike from cover.";
  assert.ok(text.includes(strategyQuote(text)));
  for (const name of Object.values(ATTACK_NAMES))
    assert.ok(name.split(/\s+/).length <= 2);
});
test("long strategy quotes begin and end on whole words instead of trailing sentence fragments", () => {
  for (const text of [
    "Stay airborne with my butterfly wings and keep the water channels below me. Against the dragon, counter after its attack.",
    "Against the turtle, watch his mouth charge and dodge across the dry raised crossing only after he commits his aim."
  ]) {
    const quote = strategyQuote(text);
    assert.ok(text.startsWith(quote));
    assert.ok(quote.length <= 64 && quote.length > 0);
    assert.ok(
      !/[A-Za-z]$/.test(quote) || !/[A-Za-z]/.test(text[quote.length] ?? "")
    );
  }
});

test("battle names use Yuni for legacy species without changing nicknames or existing Yuni names", () => {
  for (const [legacy, expected] of [
    ["Uniturtle #1", "Yuniturtle #1"],
    ["Unibranch", "Yunibranch"],
    ["Unifairy", "Yunifairy"],
    ["Elrond Unidragon #3", "Elrond Yunidragon #3"],
    ["uniturtle", "yuniturtle"],
    ["UNIBRANCH", "YUNIBRANCH"],
    ["Yuniturtle", "Yuniturtle"],
    ["YUNIBRANCH", "YUNIBRANCH"],
    ["Cedar", "Cedar"]
  ]) {
    assert.equal(animeFighterName(legacy!), expected);
    assert.equal(animeFighterName(animeFighterName(legacy!)), expected);
  }
});

test("winner labels use Yuni while combat data and verbatim strategies retain their original text", () => {
  const tournament = structuredClone(fixture);
  const winner = tournament.matches[0]!.winnerId;
  tournament.fighters[winner]!.name = "Unibranch #2";
  const before = JSON.stringify(tournament);
  const looks = Object.fromEntries(
    Object.keys(tournament.fighters).map((id) => [id, { attackKind: "vine" }])
  );
  const quote = "Unibranch strikes from cover.";
  const choreography = directTournament(tournament, looks, { [winner]: quote });
  assert.equal(
    choreography[tournament.matches[0]!.id]!.result,
    "Yunibranch #2 wins."
  );
  assert.equal(strategyQuote(quote), quote);
  assert.equal(JSON.stringify(tournament), before);
});
