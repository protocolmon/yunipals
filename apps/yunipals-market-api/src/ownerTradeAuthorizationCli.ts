import { createHash } from "node:crypto";
import { mkdir, readFile, rm, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  readOwnerTradeAuthorization,
  type OwnerTradeAction,
  type OwnerTradeSchedule
} from "@/ownerTradeAuthorization";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Set ${name} to an absolute path.`);
  return value;
}

function absolute(path: string) {
  if (!isAbsolute(path) || resolve(path) !== path || /[\r\n\0]/.test(path))
    throw new Error("Authorization paths must be absolute and normalized.");
  return path;
}

function hasAction(
  schedule: OwnerTradeSchedule,
  chain: "ethereum" | "base" | "polygon" | "bnb",
  actions: OwnerTradeAction[]
) {
  if (schedule.mode === "public")
    return (
      schedule.chains.includes(chain) &&
      actions.some((action) => schedule.actions.includes(action))
    );
  return schedule.orders.some(
    (order) => order.chain === chain && actions.includes(order.action)
  );
}

async function privateWrite(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, value, { mode: 0o600, flag: "wx" });
}

async function main() {
  if (
    process.argv.length !== 6 ||
    process.argv[2] !== "--schedule" ||
    process.argv[4] !== "--output"
  )
    throw new Error(
      "Usage: owner-trade-authorization --schedule /absolute/schedule.json --output /absolute/new-directory"
    );
  const schedulePath = absolute(argument("--schedule"));
  const output = absolute(argument("--output"));
  const source = await stat(schedulePath);
  const uid = process.getuid?.();
  if (
    uid !== 0 ||
    !source.isFile() ||
    (source.mode & 0o777) !== 0o600 ||
    source.uid !== uid
  )
    throw new Error("The owner schedule must be a private mode-0600 file.");
  const bytes = await readFile(schedulePath);
  const encoded = bytes.toString("base64url");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const authorization = readOwnerTradeAuthorization(encoded, digest);
  const temporary = `${output}.incoming-${process.pid}`;
  await mkdir(temporary, { mode: 0o700 });
  try {
    const common = [
      `MARKET_OWNER_TRADE_SCHEDULE_SHA256=${digest}`,
      `MARKET_OWNER_TRADE_SCHEDULE_BASE64=${encoded}`,
      ""
    ].join("\n");
    await privateWrite(
      `${temporary}/authorization/owner-trade-schedule.env`,
      common
    );
    if (
      hasAction(authorization.schedule, "bnb", [
        "createListing",
        "createOffer",
        "buy",
        "acceptOffer"
      ])
    )
      await privateWrite(
        `${temporary}/authorization/bnb.env`,
        `MARKET_BNB_TRADING_AUTHORIZATION=${digest}\n`
      );
    for (const chain of ["ethereum", "base", "polygon"] as const)
      if (
        hasAction(authorization.schedule, chain, [
          "createListing",
          "createOffer"
        ])
      )
        await privateWrite(
          `${temporary}/authorization/publish-${chain}.env`,
          `MARKET_OPENSEA_PUBLICATION_AUTHORIZATION=${digest}\n`
        );
    const files: Record<
      string,
      { sha256: string; bytes: number; mode: "0600" }
    > = {};
    const paths = [
      "authorization/owner-trade-schedule.env",
      "authorization/bnb.env",
      "authorization/publish-ethereum.env",
      "authorization/publish-base.env",
      "authorization/publish-polygon.env"
    ];
    for (const name of paths) {
      try {
        const contents = await readFile(`${temporary}/${name}`);
        files[name] = {
          sha256: createHash("sha256").update(contents).digest("hex"),
          bytes: contents.length,
          mode: "0600"
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await privateWrite(
      `${temporary}/authorization.json`,
      `${JSON.stringify(
        {
          formatVersion: 1,
          kind: "yunipals-marketplace-compiled-owner-trade-authorization",
          status: "verified",
          scheduleSha256: digest,
          mode: authorization.schedule.mode,
          ownerWallet: authorization.schedule.ownerWallet,
          chains: authorization.schedule.chains,
          actions: authorization.schedule.actions,
          validFrom: authorization.schedule.validFrom,
          validUntil: authorization.schedule.validUntil,
          files
        },
        null,
        2
      )}\n`
    );
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  console.log(
    JSON.stringify({
      status: "compiled",
      digest,
      mode: authorization.schedule.mode,
      chains: authorization.schedule.chains,
      actions: authorization.schedule.actions,
      output
    })
  );
}

try {
  await main();
} catch {
  console.error("Owner trade authorization compilation failed.");
  process.exitCode = 1;
}
