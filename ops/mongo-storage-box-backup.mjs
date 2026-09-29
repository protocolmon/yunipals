import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat, statfs, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";

const databases = [
  "adventures", "bsc_mainnet", "bsc_staking_mainnet", "christmas",
  "collector_staking", "ghost", "mainnet", "management", "nfts",
  "onChainEvents", "polygon_mainnet", "raffles", "staking_mainnet", "user_api"
];
const uri = process.env.MONGO_URI;
const storage = process.env.STORAGE_URI;
const password = process.env.STORAGE_PW;
if (!uri || !storage || !password || !/^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$/.test(storage)) {
  throw new Error("MONGO_URI, STORAGE_URI, and STORAGE_PW are required");
}
const workingDirectory = process.env.MONGO_BACKUP_WORKDIR ?? "/var/tmp/yunipals-mongo-backup";
const minFree = Number(process.env.MONGO_BACKUP_MIN_FREE_BYTES ?? 25_000_000_000);
if (!Number.isSafeInteger(minFree) || minFree < 0) throw new Error("Invalid backup free-space floor");
const snapshot = `mongo-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z-${randomBytes(3).toString("hex")}`;
const remoteDirectory = `yunipals-mongo-v2/${snapshot}`;
const sshEnv = { ...process.env, SSHPASS: password };

async function freeBytes() {
  const disk = await statfs(workingDirectory);
  return Number(disk.bavail) * Number(disk.bsize);
}

async function command(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    child.stdout.on("data", (part) => { stdout += part.toString(); });
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(stdout)
      : reject(new Error(`${program} failed with exit code ${code}`)));
  });
}

function ssh(commandText) {
  return command("sshpass", ["-e", "ssh", "-o", "StrictHostKeyChecking=yes",
    "-o", "ConnectTimeout=15", "-p", "23", storage, commandText], { env: sshEnv });
}

function copy(local, remote) {
  return command("sshpass", ["-e", "scp", "-o", "StrictHostKeyChecking=yes",
    "-P", "23", local, `${storage}:${remote}`], { env: sshEnv });
}

async function checksum(local) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(local)) digest.update(chunk);
  return digest.digest("hex");
}

async function uploadVerified(local, remote) {
  const expected = await checksum(local);
  const partial = `${remote}.partial`;
  await copy(local, partial);
  const output = await ssh(`sha256sum ${partial}`);
  const actual = /^([a-f0-9]{64})\s/.exec(output)?.[1];
  if (actual !== expected) throw new Error(`Storage Box checksum mismatch for ${remote}`);
  await ssh(`mv ${partial} ${remote}`);
  return expected;
}

async function dumpDatabase(database, local) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(local, { flags: "wx", mode: 0o600 });
    const child = spawn("mongodump", [
      `--uri=${uri}/${database}?authSource=admin`, "--archive", "--gzip"
    ], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(output);
    child.stderr.on("data", () => {});
    let lowSpace = false;
    const monitor = setInterval(() => {
      void freeBytes().then((free) => {
        if (free < minFree) {
          lowSpace = true;
          child.kill("SIGTERM");
        }
      }).catch(() => {
        lowSpace = true;
        child.kill("SIGTERM");
      });
    }, 5_000);
    monitor.unref();
    child.on("error", reject);
    output.on("error", reject);
    child.on("close", (code) => {
      clearInterval(monitor);
      output.end(() => code === 0 && !lowSpace
        ? resolve()
        : reject(new Error(`mongodump failed for ${database}${lowSpace ? " (disk reserve reached)" : ""}`)));
    });
  });
}

await mkdir(workingDirectory, { recursive: true, mode: 0o700 });
if (await freeBytes() < minFree) throw new Error("Backup disk reserve is already breached");
await ssh(`mkdir -p ${remoteDirectory}`);
const manifest = { format: "mongodump-archive-gzip-v1", snapshot, createdAt: new Date().toISOString(), databases: {} };
for (const database of databases) {
  const local = join(workingDirectory, `${snapshot}-${database}.archive.gz`);
  try {
    await dumpDatabase(database, local);
    const size = (await stat(local)).size;
    if (size === 0) throw new Error(`Empty dump for ${database}`);
    const sha256 = await uploadVerified(local, `${remoteDirectory}/${database}.archive.gz`);
    manifest.databases[database] = { bytes: size, sha256 };
    console.log(`Verified ${database}: ${size} bytes`);
  } finally {
    await rm(local, { force: true });
  }
}
const manifestPath = join(workingDirectory, `${snapshot}-manifest.json`);
try {
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await uploadVerified(manifestPath, `${remoteDirectory}/manifest.json`);
} finally {
  await rm(manifestPath, { force: true });
}
console.log(`Verified complete Storage Box snapshot: ${remoteDirectory}`);
