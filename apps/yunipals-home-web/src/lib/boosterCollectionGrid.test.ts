import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoosterMonster } from "@protopals/yunipals-market-core/boosters";
import type { YunipalToken } from "@/lib/yunipalsIndexer";
import {
  collectionGridIdentity,
  matchesPackGridFilters,
  mergeCollectionGrid,
  packGridFilters,
  packGridTraits,
  parsePackGridPage
} from "./boosterCollectionGrid";
import { defaultCollectorFilters } from "./collector";

const collection = "0x105319be2182018c31fb10b1be198c3cf238a146";
const owner = "0xb3883cd96d72b08b8226452305a28d65974a3727";
const otherOwner = "0x1111111111111111111111111111111111111111";
function monster(id = "1", wallet = owner): BoosterMonster {
  return {
    id: `8453:${collection}:${id}`,
    collection,
    tokenId: id,
    originalKey: `8453:${collection}:1`,
    requestKey: "8453:engine:1",
    typeKey: "8453:registry:2",
    owner: wallet,
    mintedTo: wallet,
    variantId: "73",
    monsterType: "4",
    color: "3",
    horn: "1",
    glitter: "0",
    isOriginal: id === "1",
    burned: false,
    mintBlock: "100",
    metadataUri: "https://example.test/73.json"
  } as BoosterMonster;
}
function original(): YunipalToken {
  return {
    chain: "base",
    chainId: 8453,
    contractAddress: "0x98433df878e8c898cb907345c3a7756e5f72240f",
    tokenId: "1",
    owner,
    burned: false,
    lifecycle: 0,
    mintBlock: "1",
    lastTransferBlock: "1",
    name: "OG Yunidragon",
    image: null,
    attributes: [],
    tokenUri: null,
    rarityPoints: "200",
    rarityPointsCapped: "150"
  };
}
function page(items = [monster()]) {
  return {
    chainId: 8453,
    collection,
    engine: otherOwner,
    enabled: true,
    requestsPaused: false,
    indexedBlock: "200",
    indexedBlockHash: `0x${"aa".repeat(32)}`,
    indexedTimestamp: "1792690409",
    items,
    nextCursor: null
  };
}

test("normal grid keeps OG and pack token1 separate by chain, contract and token identity", () => {
  const result = mergeCollectionGrid([original()], [monster()]);
  assert.equal(result.length, 2);
  assert.notEqual(
    collectionGridIdentity(result[0]),
    collectionGridIdentity(result[1])
  );
  assert.equal(collectionGridIdentity(result[1]), `base:${collection}:1`);
});
test("duplicate page overlaps are deduplicated without dropping OG collisions or changing original rarity", () => {
  const token = original();
  const result = mergeCollectionGrid(
    [token, token],
    [monster(), monster(), monster("2")]
  );
  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((row) => row.kind),
    ["original", "pack", "pack"]
  );
  assert.equal(
    result[0].kind === "original" && result[0].token.rarityPointsCapped,
    "150"
  );
  assert.deepEqual(token, original());
});
test("pack traits map actual configured IDs without borrowing OG metadata or rarity", () => {
  assert.deepEqual(packGridTraits(monster()), {
    Type: "Yunidragon",
    Color: "Blue",
    Horn: "Spiral",
    Glitter: "No"
  });
});
test("shared traits and Base chain filter pack cards; unknown OG traits do not silently hide them", () => {
  assert.equal(
    matchesPackGridFilters(monster(), {
      chains: ["base"],
      traits: {
        Type: ["Yunidragon"],
        Color: ["Blue"],
        Horn: ["Spiral"],
        Glitter: ["No"],
        Special: ["Yes"]
      }
    }),
    true
  );
  assert.equal(
    matchesPackGridFilters(monster(), { chains: ["ethereum"], traits: {} }),
    false
  );
  assert.equal(
    matchesPackGridFilters(monster(), {
      chains: [],
      traits: { Color: ["Green"] }
    }),
    false
  );
  assert.equal(
    matchesPackGridFilters(
      { ...monster(), burned: true },
      { chains: [], traits: {} }
    ),
    false
  );
});
test("collector shared filters preserve name/token search and do not invent rarity scores", () => {
  const filters = {
    ...defaultCollectorFilters,
    types: ["Yunidragon"],
    colors: ["Blue"],
    rarityMin: "900",
    search: "#1"
  };
  assert.equal(
    matchesPackGridFilters(monster(), packGridFilters(filters)),
    true
  );
  assert.equal(
    matchesPackGridFilters(monster("2"), packGridFilters(filters)),
    false
  );
  assert.equal(
    matchesPackGridFilters(monster(), {
      chains: [],
      traits: {},
      search: "yunidra"
    }),
    true
  );
});
test("global page includes multiple owners while profile page refuses any other owner", () => {
  const all = page([monster(), monster("2", otherOwner)]);
  assert.equal(parsePackGridPage(all, collection).items.length, 2);
  assert.throws(() => parsePackGridPage(all, collection, owner), /ownership/);
  assert.equal(
    parsePackGridPage(
      page(),
      collection,
      owner.toUpperCase().replace("0X", "0x")
    ).items.length,
    1
  );
});
test("pagination uses strictly increasing numeric IDs rather than lexical order", () => {
  const value = { ...page([monster("9"), monster("10")]), nextCursor: "10" };
  assert.equal(
    parsePackGridPage(value, collection, undefined, "8").nextCursor,
    "10"
  );
  assert.throws(
    () => parsePackGridPage(value, collection, undefined, "10"),
    /pagination/
  );
});
for (const [name, change] of [
  ["wrong collection", { collection: otherOwner }],
  ["burned item", { burned: true }],
  ["future unindexed mint", { mintBlock: "201" }],
  ["colliding false identity", { id: `8453:${collection}:2` }],
  ["missing URI", { metadataUri: "" }]
] as const)
  test(`page refuses ${name}`, () => {
    assert.throws(
      () => parsePackGridPage(page([{ ...monster(), ...change }]), collection),
      /ownership/
    );
  });
test("source mismatch, duplicate/unsorted IDs, page overflow and invented continuation are refused", () => {
  assert.throws(
    () => parsePackGridPage({ ...page(), collection: otherOwner }, collection),
    /configured/
  );
  assert.throws(
    () => parsePackGridPage(page([monster(), monster()]), collection),
    /pagination/
  );
  assert.throws(
    () =>
      parsePackGridPage(
        page(Array.from({ length: 25 }, (_, i) => monster(String(i + 1)))),
        collection
      ),
    /configured/
  );
  assert.throws(
    () => parsePackGridPage({ ...page(), nextCursor: "99" }, collection),
    /cursor/
  );
  assert.throws(
    () =>
      parsePackGridPage({ ...page(), items: [], nextCursor: "1" }, collection),
    /cursor/
  );
});
