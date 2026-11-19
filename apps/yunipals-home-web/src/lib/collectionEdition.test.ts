import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { environment } from "@/environment";
import {
  collectionDefinitions,
  collectionViewQuery,
  collectionEdition,
  collectionMigrationNotice,
  matchesOriginalEdition,
  readSavedCollectionFilters,
  resolveCollectionQuery,
  saveCollectionFilters,
  scopeEditionQuery
} from "@/lib/collectionEdition";
import {
  collectorViewQuery,
  resolveCollectorQuery,
  personalCollectionHref,
  readSavedCollectorFilters,
  saveCollectorFilters
} from "@/lib/collectorPreferences";
import { marketplaceChains } from "@/lib/marketplace/registry";
import { parseTcgCollectionFilters } from "@/lib/tcgCollectionFilters";
import {
  clearCollectionFilters,
  cloneCollectionFilters,
  countCollectionFilters,
  serializeCollectionFilters
} from "@/lib/collectionBrowserFilters";

test("TCG sequence filters preserve zero, range and original-only through URLs, drafts and clearing", () => {
  const parsed = parseTcgCollectionFilters(
    new URLSearchParams("sequenceMin=0&sequenceMax=5&t.Color=Blue")
  );
  assert.equal(parsed.sequenceMin, "0");
  assert.equal(parsed.sequenceMax, "5");
  assert.equal(
    serializeCollectionFilters(cloneCollectionFilters(parsed)).get(
      "sequenceMin"
    ),
    "0"
  );
  assert.equal(countCollectionFilters({ ...parsed, chains: [] }), 2);
  const originals = parseTcgCollectionFilters(
    new URLSearchParams("originalOnly=true&sequenceMin=7")
  );
  assert.equal(originals.originalOnly, true);
  assert.equal(originals.sequenceMin, "");
  assert.equal(
    serializeCollectionFilters(originals).get("originalOnly"),
    "true"
  );
  const cleared = serializeCollectionFilters(clearCollectionFilters(originals));
  assert.equal(cleared.has("originalOnly"), false);
  assert.equal(cleared.has("sequenceMin"), false);
  const reversed = parseTcgCollectionFilters(
    new URLSearchParams("sequenceMin=10&sequenceMax=2")
  );
  assert.equal(reversed.sequenceMin, "2");
  assert.equal(reversed.sequenceMax, "10");
  for (const invalid of ["-1", "1.5", "1e2", "4294967296", "abc"]) {
    assert.equal(
      parseTcgCollectionFilters(new URLSearchParams({ sequenceMin: invalid }))
        .sequenceMin,
      ""
    );
  }
});

const originalExomonEnabled = environment.exomonEnabled;
const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage"
);
afterEach(() => {
  environment.exomonEnabled = originalExomonEnabled;
  if (originalStorage)
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
function storage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    }
  });
  return values;
}

test("Base OG and TCG contracts with the same token ID belong to distinct views", () => {
  const token = {
    chain: "base",
    contractAddress: marketplaceChains.base.contractAddress,
    tokenId: "1"
  };
  assert.equal(matchesOriginalEdition(token, "airdrop"), true);
  assert.equal(matchesOriginalEdition(token, "og"), false);
  assert.equal(
    matchesOriginalEdition(
      {
        ...token,
        contractAddress: "0x1111111111111111111111111111111111111111"
      },
      "airdrop"
    ),
    false
  );
  for (const chain of collectionDefinitions.og.chains)
    assert.equal(
      matchesOriginalEdition(
        { chain, contractAddress: marketplaceChains[chain].contractAddress },
        "og"
      ),
      true
    );
});

test("legacy Base and mixed chain links migrate without widening a collection", () => {
  assert.equal(
    collectionEdition(new URLSearchParams("edition=og&chain=base")),
    "airdrop"
  );
  const mixed = new URLSearchParams("chain=base&chain=ethereum&q=32");
  const resolved = resolveCollectionQuery(mixed, "edition=tcg");
  assert.equal(resolved.get("edition"), "og");
  assert.deepEqual(resolved.getAll("chain"), ["ethereum"]);
  assert.equal(resolved.get("q"), "32");
  assert.match(collectionMigrationNotice(mixed)!, /OG Airdrop/);
  for (const edition of ["og", "airdrop", "tcg"] as const) {
    const cleared = scopeEditionQuery(
      new URLSearchParams(`edition=${edition}`)
    );
    assert.deepEqual(
      cleared.getAll("chain"),
      collectionDefinitions[edition].chains
    );
  }
});

test("saved filters remain independent by view and by public versus personal browsing", () => {
  storage();
  saveCollectorFilters("edition=og&chain=bnb&q=12");
  saveCollectorFilters("edition=airdrop&q=42");
  saveCollectorFilters("edition=tcg&t.Color=Blue");
  saveCollectionFilters("edition=og&chain=polygon");
  assert.equal(
    new URLSearchParams(readSavedCollectorFilters("og")!).get("q"),
    "12"
  );
  assert.equal(
    new URLSearchParams(readSavedCollectorFilters("airdrop")!).get("q"),
    "42"
  );
  assert.equal(
    new URLSearchParams(readSavedCollectorFilters()!).get("edition"),
    "tcg"
  );
  assert.deepEqual(
    new URLSearchParams(readSavedCollectionFilters()!).getAll("chain"),
    ["polygon"]
  );
  assert.match(personalCollectionHref("0x123"), /edition=tcg/);
  assert.equal(
    new URL(
      personalCollectionHref("0x123", "airdrop"),
      "http://localhost"
    ).searchParams.get("q"),
    "42"
  );
});

test("legacy Not Base preferences cannot leak into TCG or the airdrop", () => {
  const values = storage();
  values.set(
    "yunipals.collector.filters.v1",
    "chain=ethereum&chain=polygon&chain=bnb&rarityMin=200"
  );
  assert.equal(readSavedCollectorFilters("tcg"), null);
  assert.equal(readSavedCollectorFilters("airdrop"), null);
  assert.equal(
    new URLSearchParams(readSavedCollectorFilters("og")!).get("rarityMin"),
    "200"
  );
  const tcg = parseTcgCollectionFilters(
    new URLSearchParams(
      "edition=tcg&chain=ethereum&rarityMin=999&sort=rarity-capped-desc&t.Color=Blue&t.Horn=Spiral&t.Color=invalid"
    )
  );
  assert.deepEqual(tcg.chains, ["base"]);
  assert.equal(tcg.rarityMin, "");
  assert.equal(tcg.sort, "token-id-asc");
  assert.deepEqual({ ...tcg.traits }, { Color: ["Blue"], Horn: ["Spiral"] });
});

test("edition-specific public preferences survive migration from v2", () => {
  const values = storage();
  values.set("yunipals.collection.filters.v2", "edition=tcg");
  values.set(
    "yunipals.collection.filters.v2.og",
    "edition=og&chain=bnb&t.Color=Red"
  );
  assert.equal(
    new URLSearchParams(readSavedCollectionFilters("og")!).get("t.Color"),
    "Red"
  );
});

test("Base preferences stored under the old OG tab migrate into OG Airdrop", () => {
  const values = storage();
  values.set("yunipals.collection.filters.v2", "edition=tcg");
  values.set(
    "yunipals.collection.filters.v2.og",
    "edition=og&chain=base&t.Color=Green"
  );
  const airdrop = new URLSearchParams(readSavedCollectionFilters("airdrop")!);
  assert.equal(airdrop.get("edition"), "airdrop");
  assert.deepEqual(airdrop.getAll("chain"), []);
  assert.equal(airdrop.get("t.Color"), "Green");
});

test("default collection URLs omit implicit networks while API queries retain membership", () => {
  for (const edition of ["og", "airdrop", "tcg"] as const) {
    const view = collectionViewQuery(new URLSearchParams(`edition=${edition}`));
    assert.deepEqual(view.getAll("chain"), []);
    assert.deepEqual(
      scopeEditionQuery(view).getAll("chain"),
      collectionDefinitions[edition].chains
    );
  }
  for (const legacy of [
    "chain=ethereum&chain=polygon&chain=bnb&edition=og",
    "excludeChain=base"
  ]) {
    assert.equal(
      collectionViewQuery(new URLSearchParams(legacy)).toString(),
      "edition=og"
    );
  }
  const subset = collectionViewQuery(
    new URLSearchParams("edition=og&chain=bnb&t.Color=Red")
  );
  assert.deepEqual(subset.getAll("chain"), ["bnb"]);
  assert.equal(subset.get("t.Color"), "Red");
  storage();
  saveCollectionFilters("edition=og&chain=ethereum&chain=polygon&chain=bnb");
  assert.equal(readSavedCollectionFilters("og"), "edition=og");
});

test("collector defaults and saved URLs stay EVM-only with Exomon enabled", () => {
  environment.exomonEnabled = true;
  const values = storage();
  for (const edition of ["og", "airdrop", "tcg"] as const) {
    const view = collectorViewQuery(new URLSearchParams(`edition=${edition}`));
    assert.deepEqual(view.getAll("chain"), []);
    assert.deepEqual(
      resolveCollectorQuery(view, null).getAll("chain"),
      collectionDefinitions[edition].chains
    );
    saveCollectorFilters(view.toString());
    const saved = readSavedCollectorFilters(edition)!;
    assert.deepEqual(new URLSearchParams(saved).getAll("chain"), []);
    assert.deepEqual(
      resolveCollectorQuery(new URLSearchParams(), saved).getAll("chain"),
      collectionDefinitions[edition].chains
    );
  }
  // Repair preferences written by public scoping without losing trait/search choices.
  values.set(
    "yunipals.collector.filters.v2.og",
    "edition=og&chain=solana&chain=bnb&q=32&t.Color=Blue"
  );
  const saved = readSavedCollectorFilters("og")!;
  assert.deepEqual(new URLSearchParams(saved).getAll("chain"), ["bnb"]);
  assert.equal(new URLSearchParams(saved).get("q"), "32");
  assert.equal(new URLSearchParams(saved).get("t.Color"), "Blue");
  assert.deepEqual(
    new URL(
      personalCollectionHref("0x123", "og"),
      "http://localhost"
    ).searchParams.getAll("chain"),
    ["bnb"]
  );
  const solana = new URLSearchParams("edition=og&chain=solana");
  assert.match(
    collectionMigrationNotice(solana, "collector")!,
    /Incompatible network filters/
  );
  assert.equal(collectionMigrationNotice(solana), null);
  saveCollectionFilters(solana.toString());
  assert.deepEqual(
    new URLSearchParams(readSavedCollectionFilters("og")!).getAll("chain"),
    ["solana"]
  );
  // Clearing or round-tripping the full EVM selection must not add Solana or churn the URL.
  const cleared = collectorViewQuery(
    new URLSearchParams("edition=og&chain=ethereum&chain=polygon&chain=bnb")
  );
  assert.equal(cleared.toString(), "edition=og");
  assert.equal(
    collectorViewQuery(resolveCollectorQuery(cleared, null)).toString(),
    cleared.toString()
  );
});
