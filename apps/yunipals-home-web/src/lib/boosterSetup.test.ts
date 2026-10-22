import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { packRegistryAbi } from "@protopals/yunipals-market-core/boosterAbi";
import { validateBoosterCatalog } from "@protopals/yunipals-market-core/boosterCatalog";
import {
  boosterSetupArguments,
  boosterSetupOwner,
  checkPublishedBoosterSetup,
  matchesBoosterSetup,
  readBoosterSetup,
  validateBoosterSetup,
  type BoosterSetupBundle
} from "./boosterSetup";

const deployment = {
  registry: "0xeaee2da120a398f21729d50672ac5d1dd71d7274" as Address,
  engine: "0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609" as Address,
  monsters: "0x105319be2182018c31fb10b1be198c3cf238a146" as Address
};
function fixture(kind: "smoke" | "standard" = "smoke"): BoosterSetupBundle {
  const standard = kind === "standard";
  const base = `https://api.yunipals.com/yunipals-indexer/v1/boosters/art/base-mainnet-${kind}-v1/`;
  const bundle: BoosterSetupBundle = {
    schemaVersion: 1,
    chainId: 8453,
    admin: boosterSetupOwner.toLowerCase() as Address,
    ...deployment,
    expectedTypeCount: standard ? "1" : "0",
    pack: {
      schemaVersion: 1,
      slug: standard ? "base-mainnet-standard-v1" : "base-mainnet-smoke-v1",
      status: "ready",
      chainId: 8453,
      engine: deployment.engine,
      paymentToken: "0xe5a54a517cde8ed48a336b173044b1138aa2c1a3",
      priceRaw: "1000000000000000000",
      intervalSeconds: "86400",
      mintsPerInterval: 1,
      maxBatch: 7,
      baseGas: 450000,
      perMintGas: 250000,
      confirmations: 3,
      supplyCap: standard ? null : "1",
      typeIds: Array.from({ length: 11 }, (_, i) => i + 1),
      colorIds: [1, 2, 3, 4, 5, 6],
      hornIds: [1, 2],
      glitterIds: [0, 1],
      allowedVariantIds: [],
      artworkHash: `0x${"ab".repeat(32)}`,
      manifestURI: base + "manifest.json",
      metadataBaseURI: base
    },
    catalogHash: "0x",
    configureData: "0x"
  };
  const { rules, catalog } = boosterSetupArguments(bundle);
  bundle.catalogHash = validateBoosterCatalog(catalog).catalogHash;
  bundle.configureData = encodeFunctionData({
    abi: packRegistryAbi,
    functionName: "configureType",
    args: [0n, rules, catalog]
  });
  return bundle;
}

test("owner setup accepts the exact full 264-variant capped Base pack and independently recomputes calldata", () => {
  const b = fixture();
  assert.deepEqual(validateBoosterSetup(b, deployment), b);
  const { rules, catalog } = boosterSetupArguments(b);
  assert.equal(
    matchesBoosterSetup(
      b,
      {
        rules,
        catalogHash: b.catalogHash,
        ruleHash: `0x${"aa".repeat(32)}`,
        totalVariants: 0,
        openings: 0n,
        active: false,
        salesPaused: false
      },
      catalog
    ),
    true
  );
  assert.equal(
    matchesBoosterSetup(
      b,
      {
        rules: { ...rules, supplyCap: 0n },
        catalogHash: b.catalogHash,
        ruleHash: `0x${"aa".repeat(32)}`,
        totalVariants: 264,
        openings: 0n,
        active: true,
        salesPaused: false
      },
      catalog
    ),
    false
  );
});

test("standard setup is independently selected and explicitly unlimited; smoke and standard cannot be substituted", () => {
  const smoke = fixture();
  const standard = fixture("standard");
  assert.deepEqual(
    validateBoosterSetup(standard, deployment, "standard"),
    standard
  );
  assert.equal(boosterSetupArguments(standard).rules.supplyCap, 0n);
  assert.throws(() => validateBoosterSetup(standard, deployment));
  assert.throws(() => validateBoosterSetup(smoke, deployment, "standard"));
  for (const replacement of ["0", "1", "2"]) {
    const tampered = fixture("standard");
    Object.assign(tampered.pack, { supplyCap: replacement });
    assert.throws(() => validateBoosterSetup(tampered, deployment, "standard"));
  }
  const premature = fixture("standard");
  premature.expectedTypeCount = "0";
  assert.throws(() => validateBoosterSetup(premature, deployment, "standard"));
  const laterRegistry = fixture("standard");
  laterRegistry.expectedTypeCount = "2";
  assert.throws(() =>
    validateBoosterSetup(laterRegistry, deployment, "standard")
  );
});

test("standard bytes require their own file and SHA pin", async () => {
  const originalFetch = globalThis.fetch;
  const bytes = new TextEncoder().encode(
    JSON.stringify(fixture("standard")) + "\n"
  );
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  try {
    globalThis.fetch = async (url) => {
      assert.equal(url, "/boosters/mainnet-standard-setup.json");
      return new Response(bytes);
    };
    assert.deepEqual(
      await readBoosterSetup(digest, deployment, undefined, "standard"),
      fixture("standard")
    );
    await assert.rejects(readBoosterSetup(digest, deployment));
    await assert.rejects(
      readBoosterSetup("", deployment, undefined, "standard"),
      /not published/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tampered economics, deployment, traits and calldata cannot reach owner transaction preparation", () => {
  const cases: Array<(bundle: BoosterSetupBundle) => void> = [
    (b) => {
      b.admin = deployment.engine;
    },
    (b) => {
      b.registry = deployment.engine;
    },
    (b) => {
      b.engine = deployment.monsters;
    },
    (b) => {
      b.monsters = deployment.registry;
    },
    (b) => {
      b.pack.paymentToken = deployment.registry;
    },
    (b) => {
      Object.assign(b.pack, { supplyCap: "0" });
    },
    (b) => {
      Object.assign(b.pack, { priceRaw: "2000000000000000000" });
    },
    (b) => {
      Object.assign(b.pack, { intervalSeconds: "43200" });
    },
    (b) => {
      b.pack.hornIds = [1];
    },
    (b) => {
      b.pack.glitterIds = [1, 0];
    },
    (b) => {
      b.pack.allowedVariantIds = [0, 1];
    },
    (b) => {
      b.pack.artworkHash = `0x${"00".repeat(32)}`;
    },
    (b) => {
      b.pack.baseGas = 1000000;
    },
    (b) => {
      b.pack.metadataBaseURI = "http://localhost:9019/";
    },
    (b) => {
      b.configureData = (b.configureData.slice(0, -2) + "ff") as Hex;
    },
    (b) => {
      b.catalogHash = `0x${"aa".repeat(32)}`;
    }
  ];
  for (const change of cases) {
    const b = fixture();
    change(b);
    assert.throws(() => validateBoosterSetup(b, deployment));
  }
});

test("whole-file checksum pins exact published setup bytes and rejects a modified package", async () => {
  const originalFetch = globalThis.fetch;
  const bytes = new TextEncoder().encode(JSON.stringify(fixture()) + "\n");
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  try {
    globalThis.fetch = async (url) => {
      assert.equal(url, "/boosters/mainnet-smoke-setup.json");
      return new Response(bytes);
    };
    assert.deepEqual(await readBoosterSetup(digest, deployment), fixture());
    globalThis.fetch = async () => new Response(JSON.stringify(fixture()));
    await assert.rejects(
      readBoosterSetup(digest, deployment),
      /checksum changed/
    );
    await assert.rejects(readBoosterSetup("", deployment), /not published/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the actual public artwork manifest must match both frozen commitments before either owner call", async () => {
  const b = fixture();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      assert.equal(url, b.pack.manifestURI);
      return new Response(
        JSON.stringify({
          artworkHash: b.pack.artworkHash,
          catalogHash: b.catalogHash,
          metadataBaseURI: b.pack.metadataBaseURI
        })
      );
    };
    await checkPublishedBoosterSetup(b);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          artworkHash: b.pack.artworkHash,
          catalogHash: `0x${"00".repeat(32)}`,
          metadataBaseURI: b.pack.metadataBaseURI
        })
      );
    await assert.rejects(
      checkPublishedBoosterSetup(b),
      /differs from the frozen/
    );
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    await assert.rejects(checkPublishedBoosterSetup(b), /Publish the artwork/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
