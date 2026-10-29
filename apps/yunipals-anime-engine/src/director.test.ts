import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { animeFighterName } from "./fighterNames.js";
import {
  directTournament,
  strategyQuote,
  ATTACK_NAMES,
  type AnimeTournament
} from "./director.ts";
const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/tournament.json", import.meta.url), "utf8")
) as AnimeTournament;
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
