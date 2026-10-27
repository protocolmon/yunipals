// Build a fresh public launch package only. No RPC client, nonce or signer.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(
  resolve(root, "apps/yunipals-home-web/package.json")
);
const { keccak256 } = require("viem");
const digest = (raw) => createHash("sha256").update(raw).digest("hex");
const json = async (path) =>
  JSON.parse(await readFile(resolve(root, path), "utf8"));
const hex = (value) => (value.startsWith("0x") ? value : `0x${value}`);

async function boosterArtifact(
  name,
  expectedCreation,
  expectedRuntime,
  positions
) {
  const file = `contracts/boosters/out-permit/${name}.sol/${name}.json`;
  const data = await json(file);
  const creationBytecode = hex(data.bytecode.object);
  const runtimeTemplate = hex(data.deployedBytecode.object);
  assert.equal((creationBytecode.length - 2) / 2, expectedCreation);
  assert.equal((runtimeTemplate.length - 2) / 2, expectedRuntime);
  const references = Object.values(
    data.deployedBytecode.immutableReferences ?? {}
  )
    .flat()
    .map(({ start, length }) => ({ offset: start, length, value: "self" }));
  assert.deepEqual(
    references.map((row) => row.offset),
    positions
  );
  for (const row of references) {
    assert.equal(row.length, 32);
    assert.equal(
      runtimeTemplate.slice(2 + row.offset * 2, 2 + (row.offset + 32) * 2),
      "0".repeat(64)
    );
  }
  return {
    contractName: name,
    creationBytecode,
    creationKeccak256: keccak256(creationBytecode),
    runtimeTemplate,
    runtimeTemplateKeccak256: keccak256(runtimeTemplate),
    immutableReferences: references
  };
}

export async function prepareYpalFreshLaunch() {
  const source = "contracts/boosters/src/BoosterPacks.sol";
  assert.equal(
    digest(await readFile(resolve(root, source))),
    "6006e9a0ce44302ee14ebbdb43d49ed07746a0766278885c5958783a6085cfd8",
    "The reviewed permit engine source must remain unchanged"
  );
  const compiledYpal = await json(
    "contracts/ypal/evidence/YPAL.deployment.json"
  );
  assert.equal(
    digest(
      await readFile(
        resolve(root, "contracts/ypal/evidence/YPAL.deployment.json")
      )
    ),
    "fab7be912152379a9a51a5e82532547db46df2a4ae98603ff6a530d94840baa3"
  );
  assert.equal(
    digest(await readFile(resolve(root, "contracts/ypal/src/YPAL.sol"))),
    "a416138f3045d1109d66d7ffb64e1c64327ca77d96fb8231031facb11eb39394"
  );
  assert.equal(
    compiledYpal.comparison.normalizedBrandingReconstructsExactVerifiedSource,
    true
  );
  assert.equal(compiledYpal.comparison.completeAbiUnchanged, true);
  const ypal = Object.fromEntries(
    [
      "contractName",
      "creationBytecode",
      "creationKeccak256",
      "runtimeTemplate",
      "runtimeTemplateKeccak256",
      "immutableReferences"
    ].map((key) => [key, compiledYpal[key]])
  );
  assert.equal(ypal.contractName, "YPAL");
  assert.equal(keccak256(ypal.creationBytecode), ypal.creationKeccak256);
  assert.equal(keccak256(ypal.runtimeTemplate), ypal.runtimeTemplateKeccak256);
  assert.ok(ypal.immutableReferences.length > 0);
  for (const row of ypal.immutableReferences) {
    assert.equal(row.value, "pmon");
    assert.equal(row.length, 32);
    assert.ok(Number.isSafeInteger(row.offset) && row.offset >= 0);
    assert.equal(
      ypal.runtimeTemplate.slice(2 + row.offset * 2, 2 + (row.offset + 32) * 2),
      "0".repeat(64)
    );
  }
  const standard = await json(
    "docs/boosters/mainnet-launch/pack.standard.ready.json"
  );
  assert.equal(standard.priceRaw, "1000000000000000000");
  assert.equal(standard.intervalSeconds, "86400");
  assert.equal(standard.mintsPerInterval, 1);
  assert.equal(standard.supplyCap, null);
  const artifacts = {
    ypal,
    registry: await boosterArtifact("PackRegistry", 13236, 13005, [5953, 6160]),
    monsters: await boosterArtifact(
      "YunipalMonsters",
      13763,
      13532,
      [2470, 3225]
    ),
    engine: await boosterArtifact("BoosterPacks", 24800, 24569, [2273, 2569]),
    proxy: await boosterArtifact("ERC1967Proxy", 628, 89, [])
  };
  for (const [name, creation, runtime] of [
    [
      "registry",
      "0xfc75bd90e9a08f28d441da1dc72220f9d42d5bffaa592e67ce52fbf8ec74b3b7",
      "0xc45e8498696f6954109cc0f823b5367e537adcd2a8fe73ce207a3ed36a2fbea9"
    ],
    [
      "monsters",
      "0xaa124342bfe3c5788fa63b75a3c8b0b8765210c075058c94062595932b881200",
      "0xafea1d24a62cb3059b12fe9db9d544f4cc38fabaa4acfa48b24c1bcd5867cac0"
    ],
    [
      "proxy",
      "0x727162561da23fcd4e2dffacc728e3efbf19204d3672146eb228733240c2928e",
      "0xa7022e521c634305b0b86f45a8c10af47878d58952877dac7af4a6cbbb165d34"
    ]
  ]) {
    assert.equal(artifacts[name].creationKeccak256, creation);
    assert.equal(artifacts[name].runtimeTemplateKeccak256, runtime);
  }
  assert.equal(
    artifacts.engine.creationKeccak256,
    "0xf023699aa88555c93441bd0a9cdecd621b1d5387a047ef704e68bf496411189c"
  );
  assert.equal(
    artifacts.engine.runtimeTemplateKeccak256,
    "0x9b40d5a6910713f30cbb8c2df1197b2332b77bf98741e1c0e7711fd6a10d49e7"
  );
  return {
    format: "yunipals-ypal-fresh-launch-v1",
    launchId: "base-ypal-v1",
    chainId: 8453,
    owner: "0xB3883Cd96d72B08b8226452305A28D65974a3727",
    pmon: "0x60edae6E86546428DA423b5FBe0fba46Ca552Fc7",
    burnAddress: "0xff2Ba07e6F84D22730eD78D1117735a4B041c6EF",
    vrfWrapper: "0xb0407dbe851f8318bd31404A49e658143C982F23",
    tokenMetadataBasePrefix:
      "https://api.yunipals.com/yunipals-indexer/v1/boosters/metadata/",
    artifacts,
    pack: {
      priceRaw: standard.priceRaw,
      intervalSeconds: standard.intervalSeconds,
      mintsPerInterval: 1,
      maxBatch: 7,
      baseGas: 450000,
      perMintGas: 250000,
      confirmations: 3,
      supplyCap: "0",
      artworkHash: standard.artworkHash,
      manifestURI: standard.manifestURI,
      metadataBaseURI: standard.metadataBaseURI,
      catalog: {
        types: standard.typeIds,
        colors: standard.colorIds,
        horns: standard.hornIds,
        glitters: standard.glitterIds,
        allowed: []
      }
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const value = await prepareYpalFreshLaunch();
  const bytes = JSON.stringify(value, null, 2) + "\n";
  for (const relative of [
    "docs/boosters/ypal-fresh-launch-2026-10-23/launch.unsigned.json",
    "apps/yunipals-home-web/public/boosters/ypal-fresh-launch-v1.json"
  ]) {
    const path = resolve(root, relative);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, bytes, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST" || (await readFile(path, "utf8")) !== bytes)
        throw error;
    }
  }
  console.log(
    JSON.stringify(
      {
        launchId: value.launchId,
        packageSha256: digest(bytes),
        creationTransactions: 7,
        configurationTransactions: 3,
        testPackTypes: 0,
        publicPackTypes: 1,
        addressesFromConfirmedReceiptsOnly: true,
        mainnetBroadcasts: 0
      },
      null,
      2
    )
  );
}
