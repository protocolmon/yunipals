#!/usr/bin/env node
// Source packaging only: never imports application code or loads environment files.
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../../", import.meta.url));
const publication =
  "docs/islands/arena-artwork-production-v2/https-releases/4d50ebe8ec0d1ae8c0b9b9f94ad3daef21a7235b06d07df2412fb33c139fc1f9/public";
const sourceRoots = [
  "apps/yunipals-indexer",
  "apps/yunipals-market-api",
  "packages/yunipals-indexer-client",
  "packages/yunipals-indexer-server",
  "packages/yunipals-market-core",
  "scripts/arena",
  "ops/unified-indexer/service-overrides"
];
const extensions = new Set([
  ".ts",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".json",
  ".txt",
  ".sql",
  ".py",
  ".sh",
  ".md"
]);
const excludedDirectories = new Set([
  "node_modules",
  "dist",
  ".ponder",
  ".git",
  "__pycache__",
  ".cache",
  "coverage"
]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const fail = (message) => {
  throw new Error(message);
};

function safePath(path) {
  if (
    !/^[A-Za-z0-9@_./+-]+$/.test(path) ||
    path.split("/").some((part) => part === ".." || part.startsWith("."))
  )
    fail(`Unsafe release path: ${path}`);
  if (
    /(^|\/)(?:secrets?|credentials?|id_rsa|id_ed25519)(?:[./-]|$)/i.test(
      path
    ) ||
    /\.(?:pem|key|p12|pfx|log|dump|zip|png|jpe?g|webp|mp[34]|img|env)$/i.test(
      path
    )
  )
    fail(`Private, generated or media path is forbidden: ${path}`);
}

async function bytesAt(base, path) {
  safePath(path);
  // Check every ancestor so a directory symlink cannot escape the allowlist.
  let current = base;
  for (const part of path.split("/")) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink())
      fail(`Symlink is forbidden: ${path}`);
  }
  const stat = await lstat(current);
  if (!stat.isFile() || stat.size > 5_000_000)
    fail(`Not a small regular source file: ${path}`);
  return readFile(current);
}

async function walk(base, path) {
  const files = [];
  for (const entry of (
    await readdir(join(base, path), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (entry.name.startsWith(".") || excludedDirectories.has(entry.name))
      continue;
    const child = `${path}/${entry.name}`;
    if (entry.isSymbolicLink())
      fail(`Symlink is forbidden in source tree: ${child}`);
    if (entry.isDirectory()) files.push(...(await walk(base, child)));
    else if (
      extensions.has(extname(child)) ||
      entry.name.endsWith(".conf.example") ||
      entry.name === "LICENSE"
    )
      files.push(child);
  }
  return files;
}

async function externalAssets() {
  const assets = [];
  for (const file of (await readdir(join(root, publication, "metadata")))
    .filter((name) => name.endsWith(".json"))
    .sort()) {
    const metadata = JSON.parse(
      await readFile(join(root, publication, "metadata", file), "utf8")
    );
    const tokenId = metadata.properties.token_id;
    if (!/^[1-9][0-9]*$/.test(tokenId) || file !== `${tokenId}.json`)
      fail("Invalid published island token filename.");
    assets.push({
      path: `${publication}/images/${tokenId}.png`,
      sha256: metadata.properties.image_sha256,
      authority: `${publication}/metadata/${file}`
    });
  }
  if (assets.length !== 898)
    fail("Expected exactly 898 published island images.");
  const registry = "docs/arena/identity-registry-v1/profiles.json";
  for (const profile of JSON.parse(await readFile(join(root, registry), "utf8"))
    .profiles) {
    assets.push({
      path: `docs/arena/identity-registry-v1/references/${profile.imageSha256}.img`,
      sha256: profile.imageSha256,
      authority: registry
    });
  }
  const music = "docs/islands/race-film-v4/audio/split-in-synapse-original.mp3";
  // Only this small public music file is read for its digest; no media bytes are packaged.
  assets.push({
    path: music,
    sha256: sha(await readFile(join(root, music))),
    authority: "scripts/arena/media_tools.py and render.py"
  });
  for (const asset of assets)
    if (!/^[a-f0-9]{64}$/.test(asset.sha256))
      fail("Missing public artwork checksum.");
  return {
    format: "yunipals-external-runtime-assets-v1",
    purpose:
      "Retain or mount before enabling native Arena media/inspection; files intentionally excluded from the source archive.",
    assets: assets.sort((a, b) => a.path.localeCompare(b.path, "en"))
  };
}

async function verify(directory) {
  const manifest = JSON.parse(
    await readFile(join(directory, "RELEASE-MANIFEST.json"), "utf8")
  );
  if (manifest.format !== "yunipals-unified-source-release-v1")
    fail("Unexpected release manifest.");
  if (sha(json(manifest.files)) !== manifest.sourceDigest)
    fail("Source inventory digest differs from manifest.");
  for (const entry of manifest.files)
    if (sha(await bytesAt(directory, entry.path)) !== entry.sha256)
      fail(`Source checksum mismatch: ${entry.path}`);
  const lines =
    manifest.files.map((entry) => `${entry.sha256}  ${entry.path}`).join("\n") +
    "\n";
  if ((await readFile(join(directory, "SHA256SUMS"), "utf8")) !== lines)
    fail("Checksum list differs from release manifest.");
  return {
    verifiedFiles: manifest.files.length,
    sourceDigest: manifest.sourceDigest
  };
}

async function prepare() {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (
    process.versions.node !== "24.18.1" ||
    pkg.engines.node !== "24.18.1" ||
    pkg.packageManager !== "pnpm@9.12.0"
  )
    fail("Use the pinned Node 24.18.1 / pnpm 9.12.0 toolchain.");
  const files = new Set([
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml"
  ]);
  for (const path of Object.values(pkg.pnpm.patchedDependencies))
    files.add(path);
  for (const path of sourceRoots)
    for (const file of await walk(root, path)) files.add(file);
  for (const file of await readdir(
    join(root, "apps/yunipals-indexer/vendor")
  )) {
    if (!/^polkamon-[a-z0-9-]+-[0-9.]+\.tgz$/.test(file))
      fail("Unexpected vendored dependency.");
    files.add(`apps/yunipals-indexer/vendor/${file}`);
  }
  for (const file of await readdir(join(root, "ops/unified-indexer"))) {
    if (file === "release-package-evidence.json") continue;
    if (
      file.endsWith(".env.example") ||
      file.endsWith(".service.example") ||
      file.endsWith(".sql.example") ||
      file === "release-service-manifest.json.example" ||
      extensions.has(extname(file))
    )
      files.add(`ops/unified-indexer/${file}`);
  }
  for (const path of [
    "docs/arena/rules-v2",
    `${publication}/metadata`,
    `${publication}/profiles`
  ])
    for (const file of await walk(root, path)) files.add(file);
  for (const path of [
    "docs/arena/identity-registry-v1/profiles.json",
    "docs/unified-indexer/arena-source-rollback.md",
    "docs/unified-indexer/marketplace-source-rollback.md",
    "docs/unified-indexer/bounded-rpc-replay.md",
    "docs/unified-indexer/ownership-parity.md",
    "docs/unified-indexer/release-role-grants-2026-10-20.json",
    "docs/unified-indexer/receipt-history-floor-2026-10-20.json",
    "docs/unified-indexer/budgeted-rpc-sync-2026-10-20.json",
    "docs/unified-indexer/production-source-draft-2026-10-20.md",
    "docs/unified-indexer/production-rpc-profile-2026-10-20.draft.json",
    "docs/unified-indexer/production-receipt-floor-cardinality-2026-10-20.json",
    "docs/unified-indexer/production-bnb-sale-history-witness-2026-10-20.json",
    // Explicitly reviewed public contract/source inputs; no DB/provider/key values.
    "ops/unified-indexer/production-source.env.draft",
    "docs/islands/arena-reveal-results-v1/assignments.json",
    "contracts/boosters/config/base-standard-v1.traits.json",
    "contracts/boosters/test/fixtures/base-vrf-proofs.json",
    "contracts/boosters/test/fixtures/base-block-headers.json"
  ])
    files.add(path);

  const output = await mkdtemp("/tmp/yunipals-unified-release-");
  await chmod(output, 0o700);
  const stage = join(output, "source");
  await mkdir(stage, { mode: 0o700 });
  const entries = [];
  let total = 0;
  for (const path of [...files].sort()) {
    const bytes = await bytesAt(root, path);
    total += bytes.length;
    if (total > 25_000_000)
      fail("Release source exceeds the 25 MB allowlist budget.");
    await mkdir(dirname(join(stage, path)), { recursive: true, mode: 0o700 });
    await writeFile(join(stage, path), bytes, { mode: 0o600 });
    entries.push({ path, bytes: bytes.length, sha256: sha(bytes) });
  }
  const external = json(await externalAssets());
  total += Buffer.byteLength(external);
  if (total > 25_000_000)
    fail("Release source exceeds the 25 MB allowlist budget.");
  await writeFile(join(stage, "EXTERNAL-RUNTIME-ASSETS.json"), external, {
    mode: 0o600
  });
  entries.push({
    path: "EXTERNAL-RUNTIME-ASSETS.json",
    bytes: Buffer.byteLength(external),
    sha256: sha(external)
  });
  entries.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const sourceDigest = sha(json(entries));
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8"
  });
  const manifest = {
    format: "yunipals-unified-source-release-v1",
    sourceDigest,
    repositoryHead: head.status === 0 ? head.stdout.trim() : null,
    identity:
      "SHA256 inventory includes current tracked and untracked allowlisted source; Git HEAD alone does not identify this working tree.",
    node: "24.18.1",
    pnpm: "9.12.0",
    files: entries
  };
  await writeFile(join(stage, "RELEASE-MANIFEST.json"), json(manifest), {
    mode: 0o600
  });
  await writeFile(
    join(stage, "SHA256SUMS"),
    entries.map((entry) => `${entry.sha256}  ${entry.path}`).join("\n") + "\n",
    { mode: 0o600 }
  );
  const tar = spawnSync(
    "tar",
    [
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "--mode=u+rwX,go-rwx",
      "--format=gnu",
      "-cf",
      "-",
      "-C",
      stage,
      "."
    ],
    { maxBuffer: 32_000_000 }
  );
  if (tar.status !== 0) fail("Deterministic GNU tar failed.");
  const archive = gzipSync(tar.stdout, { level: 9, mtime: 0 });
  const filename = `yunipals-unified-${sourceDigest.slice(0, 16)}.tar.gz`;
  await writeFile(join(output, filename), archive, { mode: 0o600 });
  await writeFile(
    join(output, "SHA256SUMS"),
    `${sha(archive)}  ${filename}\n`,
    { mode: 0o600 }
  );
  return {
    output,
    archive: join(output, filename),
    archiveSha256: sha(archive),
    sourceDigest,
    files: entries.length,
    sourceBytes: total,
    archiveBytes: archive.length,
    ...(await verify(stage))
  };
}

try {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === "--verify")
    console.log(json(await verify(resolve(args[1]))).trim());
  else if (args.length === 0) console.log(json(await prepare()).trim());
  else
    fail(
      "Usage: node ops/unified-indexer/prepare-release.mjs [--verify /absolute/unpacked/source]"
    );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Release packaging failed."
  );
  process.exitCode = 1;
}
