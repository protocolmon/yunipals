import { describe, expect, it } from "vitest";
import {
  adventureOdds,
  serumCatalogue,
  serumDefinition,
  effectiveSequence,
  fusionCompatible,
  fusionPresenceOdds,
  type EvolutionSource
} from "../../../packages/yunipals-market-core/src/serums.js";
import {
  applyEvolutionEvent,
  type EvolutionProjectionStore
} from "../lib/evolution/projection.js";
import { evolutionSources } from "../lib/unified/evolution-sources.js";
import catalogue from "../../../docs/adventures-serums-catalog.draft.json";

function memory() {
  const rows = new Map<string, Record<string, unknown>>();
  const store: EvolutionProjectionStore = {
    async get(domain, id) {
      return rows.get(`${domain}:${id}`) ?? null;
    },
    async put(domain, id, value) {
      rows.set(`${domain}:${id}`, value);
    }
  };
  return { rows, store };
}
const source = (
  tokenId: string,
  sequence: number,
  originalTokenId = "1"
): EvolutionSource => ({
  tokenId,
  sequence,
  originalTokenId,
  isOriginal: sequence === 0,
  packTypeId: "1",
  variantId: 0,
  monsterType: 1,
  color: 1,
  horn: 1,
  glitter: 0
});

describe("approved evolution rules", () => {
  it("covers all 121 serum pairs and exactly matches the approved tier table", () => {
    expect(serumCatalogue).toHaveLength(121);
    expect(new Set(serumCatalogue.map((v) => v.id)).size).toBe(121);
    for (let position = 0; position < 264; position++) {
      const odds = adventureOdds(position);
      expect(odds.weights.reduce((a, b) => a + b, 0)).toBe(1_000_000);
      expect(odds.weights).toEqual(
        catalogue.odds.tiers[odds.tier - 1].weightsInOutcomeOrder
      );
    }
    expect(() => adventureOdds(264)).toThrow();
    expect(
      serumDefinition({ catalogueVersion: 1, serumId: 121, presenceId: 1 })
    ).toMatchObject({
      name: "Voidheart Avatar Serum",
      rarity: "Mythic",
      presence: "Holy"
    });
    expect(() =>
      serumDefinition({ catalogueVersion: 1, serumId: 0, presenceId: 1 })
    ).toThrow();
  });
  it("averages leaves exactly and never combines unrelated positions for first fusion", () => {
    expect(
      effectiveSequence([
        source("40", 40),
        source("41", 41),
        source("201", 201, "2"),
        source("202", 202, "2")
      ])
    ).toBe(121);
    expect(
      fusionCompatible(
        { tokenId: "1", level: 0, sources: [source("1", 0)] },
        { tokenId: "2", level: 0, sources: [source("2", 263)] }
      )
    ).toBe(false);
    expect(
      fusionCompatible(
        { tokenId: "1", level: 0, sources: [source("1", 40)] },
        { tokenId: "2", level: 0, sources: [source("2", 41, "2")] }
      )
    ).toBe(false);
    expect(fusionPresenceOdds(1, 0)).toEqual([
      { presence: 1, percent: 50 },
      { presence: 0, percent: 50 }
    ]);
    expect(fusionPresenceOdds(1, 1)).toEqual([{ presence: 1, percent: 100 }]);
  });
  it("preserves unused serum on no find and replaces it only on a successful find", async () => {
    const { store } = memory();
    await applyEvolutionEvent(store, "AdventureRequested", {
      tokenId: "1",
      requestId: "11",
      nextAdventureAt: "86400"
    });
    await applyEvolutionEvent(store, "AdventureSettled", {
      tokenId: "1",
      requestId: "11",
      catalogueVersion: 1,
      serumId: 121,
      presenceId: 1
    });
    await applyEvolutionEvent(store, "AdventureRequested", {
      tokenId: "1",
      requestId: "12",
      nextAdventureAt: "172800"
    });
    await applyEvolutionEvent(store, "AdventureSettled", {
      tokenId: "1",
      requestId: "12",
      catalogueVersion: 0,
      serumId: 0,
      presenceId: 0
    });
    expect(await store.get("card", "1")).toMatchObject({
      unused: { serumId: 121, presenceId: 1 },
      pendingAdventure: null,
      nextAdventureAt: "172800"
    });
  });
  it("retains ordered doses and clears parent pending states on successful fusion", async () => {
    const { store } = memory();
    await applyEvolutionEvent(store, "EvolutionRequested", {
      parentA: "1",
      parentB: "0",
      requestId: "11",
      randomnessId: "0",
      catalogueVersion: 1,
      serumId: 121,
      presenceId: 1
    });
    await applyEvolutionEvent(store, "EvolutionCompleted", {
      tokenId: "1",
      requestId: "11",
      localDoses: 1,
      presence: 1
    });
    await applyEvolutionEvent(store, "EvolutionRequested", {
      parentA: "1",
      parentB: "2",
      requestId: "12",
      randomnessId: "55"
    });
    expect(await store.get("job", "12")).toMatchObject({
      status: "randomness"
    });
    await applyEvolutionEvent(store, "FusionPresenceSettled", {
      requestId: "12",
      randomnessId: "55",
      presence: 0
    });
    await applyEvolutionEvent(store, "FusionMinted", {
      tokenId: "3",
      parentA: "1",
      parentB: "2",
      recipient: "0xabc",
      level: 1
    });
    await applyEvolutionEvent(store, "EvolutionCompleted", {
      tokenId: "3",
      requestId: "12",
      localDoses: 0,
      presence: 0
    });
    expect(await store.get("card", "1")).toMatchObject({
      pendingEvolution: null,
      burned: true,
      doses: [{ serumId: 121, presenceId: 1, catalogueVersion: 1 }]
    });
    expect(await store.get("card", "3")).toMatchObject({
      level: 1,
      doses: [],
      presence: 0
    });
  });
  it("requires explicit source boundaries and receipt evidence", () => {
    expect(evolutionSources({})).toEqual([]);
    expect(() => evolutionSources({ UNIFIED_EVOLUTION_JSON: "{}" })).toThrow();
    const config = Object.fromEntries(
      ["adventures", "cards", "evolution"].map((k, i) => [
        k,
        { address: `0x${String(i + 1).repeat(40)}`, startBlock: 123 }
      ])
    );
    const sources = evolutionSources({
      UNIFIED_EVOLUTION_JSON: JSON.stringify(config)
    });
    expect(sources).toHaveLength(3);
    expect(
      sources.every(
        (s) => s.receiptRequirement === "full" && s.feature === "evolution"
      )
    ).toBe(true);
  });
});
