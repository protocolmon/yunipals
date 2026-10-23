// Build only the collection rollout's public assets; prototype media stays out.
import { createHash } from "node:crypto";
import {
  mkdir,
  copyFile,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "vite";
import { validateBoosterSetup } from "../../src/lib/boosterSetup.ts";
import { ypalFrontendDeployment } from "./ypal-frontend-deployment.mjs";

const { values } = parseArgs({
  options: {
    "full-app": { type: "boolean", default: false },
    "setup-sha": { type: "string" },
    "standard-setup-sha": { type: "string" },
    "ypal-launch-sha": { type: "string" },
    "ypal-confirmed-sha": { type: "string" },
    output: {
      type: "string",
      default: "/tmp/yunipals-collection-booster-live-20261022"
    }
  }
});
if (!/^[0-9a-f]{64}$/.test(values["setup-sha"] ?? ""))
  throw Error("Pass the reviewed --setup-sha checksum.");
const app = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(app);
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const output = resolve(values.output);
if (!output.startsWith("/tmp/yunipals-collection-booster-live-"))
  throw Error("Use a task-specific fresh /tmp output directory.");
try {
  await stat(output);
  throw Error(
    "Output directory already exists; preserve it and use a fresh name."
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const metadataUpgradePackageSha =
  "e59f7ce628c8a3ed42e432a7340f495abcb2eebf3f12a4aec0cc5420363fc966";
const batchUpgradePackageSha =
  "bf06804bab6c68cd42515500af5c7118a1ee1ebf66a4f46c96a854fd7f80fc1e";
const permitUpgradePackageSha =
  "ee7eb521a91a761192a915c64bd50ff16d03143c78ecd44452cecc87bc912afc";
const ypalLaunchPackageSha = values["ypal-launch-sha"];
let ypalConfirmed = null;
if (values["ypal-confirmed-sha"] && !ypalLaunchPackageSha)
  throw Error(
    "The confirmed YPAL deployment requires the reviewed launch package."
  );
if (ypalLaunchPackageSha !== undefined) {
  if (
    !values["full-app"] ||
    ypalLaunchPackageSha !==
      "12bad482e7f34aa0dcc51033ee115b177bac4874181b4b522513adf2a3944886"
  )
    throw Error("Use the reviewed YPAL launch checksum with the full app.");
  const ypal = await readFile(
    join(app, "public/boosters/ypal-fresh-launch-v1.json")
  );
  if (sha(ypal) !== ypalLaunchPackageSha)
    throw Error(
      "The fresh YPAL launch package differs from the reviewed bytes."
    );
  if (values["ypal-confirmed-sha"]) {
    ypalConfirmed = ypalFrontendDeployment(
      ypal,
      await readFile(
        join(
          root,
          "docs/boosters/ypal-fresh-launch-2026-10-23/deployment.confirmed.json"
        )
      ),
      values["ypal-confirmed-sha"]
    );
  }
}
if (values["full-app"]) {
  const metadataUpgrade = await readFile(
    join(app, "public/boosters/monsters-token-metadata-upgrade-v1.json")
  );
  if (sha(metadataUpgrade) !== metadataUpgradePackageSha)
    throw Error(
      "The metadata upgrade package differs from the reviewed bytes."
    );
  const batchUpgrade = await readFile(
    join(app, "public/boosters/engine-batch-upgrade-v1.json")
  );
  if (sha(batchUpgrade) !== batchUpgradePackageSha)
    throw Error("The engine batch package differs from the reviewed bytes.");
  const permitUpgrade = await readFile(
    join(app, "public/boosters/engine-permit-upgrade-v1.json")
  );
  if (sha(permitUpgrade) !== permitUpgradePackageSha)
    throw Error("The engine permit package differs from the reviewed bytes.");
}
const setupFile = join(app, "public/boosters/mainnet-smoke-setup.json");
const setup = await readFile(setupFile);
if (sha(setup) !== values["setup-sha"])
  throw Error("The owner setup bundle differs from the reviewed checksum.");
const deployment = JSON.parse(
  await readFile(
    join(root, "docs/boosters/mainnet-smoke/deployment.confirmed.json")
  )
);
let addresses = {
  registry: deployment.contracts.registry.proxy,
  engine: deployment.contracts.engine.proxy,
  monsters: deployment.contracts.monsters.proxy
};
validateBoosterSetup(JSON.parse(setup), addresses);
if (values["standard-setup-sha"] !== undefined) {
  if (!/^[0-9a-f]{64}$/.test(values["standard-setup-sha"]))
    throw Error("Pass a reviewed --standard-setup-sha checksum.");
  const standard = await readFile(
    join(app, "public/boosters/mainnet-standard-setup.json")
  );
  if (sha(standard) !== values["standard-setup-sha"])
    throw Error(
      "The standard setup bundle differs from the reviewed checksum."
    );
  validateBoosterSetup(JSON.parse(standard), addresses, "standard");
}
Object.assign(process.env, {
  VITE_COLLECTION_ONLY: values["full-app"] ? "false" : "true",
  VITE_BOOSTERS_ENABLED: "true",
  VITE_BOOSTER_REGISTRY: addresses.registry,
  VITE_BOOSTER_ENGINE: addresses.engine,
  VITE_BOOSTER_MONSTERS: addresses.monsters,
  VITE_BOOSTER_SETUP_SHA256: values["setup-sha"],
  VITE_BOOSTER_STANDARD_SETUP_SHA256: values["standard-setup-sha"] ?? "",
  VITE_YUNIPALS_INDEXER_URL: "https://api.yunipals.com/yunipals-indexer",
  VITE_SELF_HOSTED: "",
  // The license plugin emits directly into this fresh curated release.
  // This is build configuration, never a browser-exposed VITE_* value.
  YUNIPALS_LICENSE_OUTPUT: join(output, "THIRD_PARTY_LICENSES.txt")
});
// Publish the fresh owner setup before any new address exists. The old test
// deployment must not be presented as a YPAL purchase or collection.
if (ypalLaunchPackageSha) {
  addresses = { registry: "", engine: "", monsters: "" };
  Object.assign(process.env, {
    VITE_BOOSTER_LAUNCH_ID: "base-ypal-v1",
    VITE_BOOSTER_PAYMENT_SYMBOL: "YPAL",
    VITE_BOOSTER_PAYMENT_TOKEN: "",
    VITE_BOOSTER_PMON: "",
    VITE_BOOSTER_DEPLOYMENT_SHA256: "",
    VITE_BOOSTERS_ENABLED: "false",
    VITE_BOOSTER_REGISTRY: "",
    VITE_BOOSTER_ENGINE: "",
    VITE_BOOSTER_MONSTERS: ""
  });
}
if (ypalConfirmed) {
  addresses = {
    registry: ypalConfirmed.registry,
    engine: ypalConfirmed.engine,
    monsters: ypalConfirmed.monsters
  };
  Object.assign(process.env, {
    VITE_BOOSTERS_ENABLED: "true",
    VITE_BOOSTER_REGISTRY: addresses.registry,
    VITE_BOOSTER_ENGINE: addresses.engine,
    VITE_BOOSTER_MONSTERS: addresses.monsters,
    VITE_BOOSTER_PAYMENT_TOKEN: ypalConfirmed.paymentToken,
    VITE_BOOSTER_PMON: ypalConfirmed.pmon,
    VITE_BOOSTER_DEPLOYMENT_SHA256: ypalConfirmed.manifestSha256
  });
}
// Preserve the main app's existing public service and feature configuration.
// Only the temporary smoke-test preset disables unrelated sections.
if (!values["full-app"]) {
  process.env.VITE_YUNIPALS_MARKETPLACE_URL = "";
  process.env.VITE_ARENA_API_URL = "";
}
await build({
  root: app,
  configFile: join(app, "vite.config.ts"),
  publicDir: false,
  build: { outDir: output, emptyOutDir: false },
  logLevel: "warn"
});
const assets = [
  ...(ypalLaunchPackageSha ? ["boosters/ypal-fresh-launch-v1.json"] : []),
  "favicon.ico",
  "favicon-32x32.png",
  "icon-192.png",
  "apple-touch-icon.png",
  "robots.txt",
  "sitemap.xml",
  "images/yunipals-logo.webp",
  "images/yunipals-social-card.jpg",
  "images/boosters/yunipals-pack-v1.png",
  ...(values["full-app"]
    ? [
        "arena/rules-v1.json",
        "images/bitcoin-unidragon-square.webp",
        "images/element/yunipals-bnb-featured-600x400.jpg",
        "images/opensea/logomark-blue.svg",
        "images/opensea/yunipals-og-ethereum-banner-desktop.jpg",
        "images/opensea/yunipals-og-ethereum-banner-mobile-wide.jpg",
        "images/opensea/yunipals-og-ethereum-banner-mobile.jpg",
        "images/yunipals-base-banner.webp",
        "images/yunipals-bnb-banner-v2.webp",
        "images/yunipals-bnb-banner.webp",
        "images/yunipals-ethereum-banner.webp",
        "images/yunipals-islands-banner.webp",
        "images/yunipals-islands-square.webp",
        "images/yunipals-polygon-banner.webp",
        "images/yunipals-polygon-square.webp"
      ]
    : []),
  "boosters/mainnet-smoke-setup.json"
];
if (values["standard-setup-sha"])
  assets.push("boosters/mainnet-standard-setup.json");
if (values["full-app"])
  assets.push(
    "boosters/monsters-token-metadata-upgrade-v1.json",
    "boosters/engine-batch-upgrade-v1.json",
    "boosters/engine-permit-upgrade-v1.json"
  );
for (const name of assets) {
  await mkdir(join(output, name, ".."), { recursive: true });
  await copyFile(join(app, "public", name), join(output, name));
}
const licenseNotice = await readFile(
  join(output, "THIRD_PARTY_LICENSES.txt"),
  "utf8"
);
if (!licenseNotice.trim())
  throw Error("The fresh third-party license notice is empty.");
async function files(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) result.push(...(await files(path)));
    else if (item.isFile()) {
      const bytes = await readFile(path);
      result.push({
        path: relative(output, path),
        bytes: bytes.byteLength,
        sha256: sha(bytes)
      });
    } else throw Error("Unexpected nonregular release asset.");
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
const entries = await files(output);
const manifest = {
  format: "yunipals-collection-booster-frontend-v1",
  builtAt: new Date().toISOString(),
  collectionOnly: !values["full-app"],
  marketplaceEnabled: Boolean(
    values["full-app"] && process.env.VITE_YUNIPALS_MARKETPLACE_URL
  ),
  arenaEnabled: values["full-app"],
  apiOrigin: process.env.VITE_YUNIPALS_INDEXER_URL,
  addresses,
  boosterLaunchId: ypalLaunchPackageSha ? "base-ypal-v1" : "base-proto-v1",
  boosterSalesConfigured: Boolean(ypalConfirmed || !ypalLaunchPackageSha),
  ypalLaunchPackageSha256: ypalLaunchPackageSha ?? null,
  ypalConfirmedDeploymentSha256: ypalConfirmed?.manifestSha256 ?? null,
  boosterPaymentToken: ypalConfirmed?.paymentToken ?? null,
  setupPackageSha256: values["setup-sha"],
  standardSetupPackageSha256: values["standard-setup-sha"] ?? null,
  metadataUpgradePackageSha256: values["full-app"]
    ? metadataUpgradePackageSha
    : null,
  batchUpgradePackageSha256: values["full-app"] ? batchUpgradePackageSha : null,
  permitUpgradePackageSha256: values["full-app"]
    ? permitUpgradePackageSha
    : null,
  publicAssets: assets,
  files: entries
};
const manifestBytes = JSON.stringify(manifest, null, 2) + "\n";
await writeFile(join(output, "RELEASE-MANIFEST.json"), manifestBytes, {
  flag: "wx"
});
console.log(
  JSON.stringify({
    format: manifest.format,
    output,
    files: entries.length,
    bytes: entries.reduce((n, file) => n + file.bytes, 0),
    manifestSha256: sha(manifestBytes),
    setupPackageSha256: values["setup-sha"],
    standardSetupPackageSha256: values["standard-setup-sha"] ?? null,
    collectionOnly: manifest.collectionOnly,
    marketplaceEnabled: manifest.marketplaceEnabled,
    arenaEnabled: manifest.arenaEnabled
  })
);
