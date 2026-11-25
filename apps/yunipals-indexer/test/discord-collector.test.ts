import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  collectorRoleIds,
  discordCollectorConfig,
  discordCollectorRoutes
} from "../lib/api/discord-collector.js";

const config = discordCollectorConfig({
  DISCORD_COLLECTOR_ENABLED: "true",
  DISCORD_COLLECTOR_DATABASE_URL: "postgres://example.test/db",
  DISCORD_COLLECTOR_CLIENT_ID: "100000000000000001",
  DISCORD_COLLECTOR_GUILD_ID: "100000000000000002",
  DISCORD_COLLECTOR_ROLE_ID: "100000000000000003",
  DISCORD_COLLECTOR_BOT_TOKEN: "test-token",
  DISCORD_COLLECTOR_REDIRECT_URI: "https://example.test/discord/callback",
  DISCORD_COLLECTOR_TIERS: JSON.stringify([
    { maxRank: 100, roleId: "100000000000000006" },
    { maxRank: 50, roleId: "100000000000000005" },
    { maxRank: 10, roleId: "100000000000000004" }
  ])
})!;
const collector = config.collectorRoleId;
const [top10, top50, top100] = config.tiers.map((tier) => tier.roleId);
const member = "100000000000000007";
const community = "100000000000000008";
const wallet = privateKeyToAccount(generatePrivateKey());
const otherWallet = privateKeyToAccount(generatePrivateKey());
const verifier = randomBytes(32).toString("base64url");
const codeChallenge = createHash("sha256").update(verifier).digest("base64url");

let db: PGlite;
let roles: Set<string>;
let rank: number | null;
let rankingUnavailable: boolean;
let joined: boolean;
const send = vi.fn(
  async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth2/token")) {
      expect((init?.body as URLSearchParams).get("code_verifier")).toBe(
        verifier
      );
      return Response.json({ access_token: "test-access" });
    }
    if (url.pathname.endsWith("/users/@me"))
      return Response.json({ id: member });
    if (url.pathname.endsWith(`/members/${member}`)) {
      return joined
        ? Response.json({ roles: [...roles] })
        : Response.json({ code: 10007 }, { status: 404 });
    }
    const role = url.pathname.match(/\/roles\/([0-9]+)$/)?.[1];
    if (role) {
      if (init?.method === "PUT") roles.add(role);
      else if (init?.method === "DELETE") roles.delete(role);
      else throw new Error("Unexpected role method");
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/roles"))
      return Response.json(
        [collector, top10, top50, top100].map((id) => ({
          id,
          permissions: "0",
          managed: false
        }))
      );
    throw new Error("Unexpected Discord request");
  }
);
let service: ReturnType<typeof discordCollectorRoutes>;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(
    await readFile(
      new URL("../deploy/discord-collector.sql", import.meta.url),
      "utf8"
    )
  );
  roles = new Set([community]);
  rank = 7;
  rankingUnavailable = false;
  joined = true;
  send.mockClear();
  const query = async (sql: string, args?: unknown[]) => {
    const result = await db.query(sql, args);
    return { rows: result.rows, rowCount: result.affectedRows };
  };
  const adapter = {
    query,
    connect: async () => ({ query, release: () => undefined })
  } as unknown as Pick<Pool, "query" | "connect">;
  service = discordCollectorRoutes(
    config,
    adapter,
    async () => {
      if (rankingUnavailable) throw new Error("Ranking unavailable");
      return rank;
    },
    send
  );
});

afterEach(async () => db.close());

function post(path: string, body: object, origin = config.origin) {
  return service.routes.request(`/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body)
  });
}

async function proof(action: "link" | "refresh" | "unlink", signer = wallet) {
  const challenge = await post("challenge", {
    action,
    wallet: signer.address,
    codeChallenge: action === "link" ? codeChallenge : undefined
  });
  expect(challenge.status).toBe(200);
  const { request, message } = await challenge.json();
  return { request, signature: await signer.signMessage({ message }) };
}

async function connect(signer = wallet) {
  const signed = await proof("link", signer);
  const start = await post("start", { ...signed, verifier });
  expect(start.status).toBe(200);
  const url = new URL((await start.json()).authorizeUrl);
  expect(url.searchParams.get("scope")).toBe("identify");
  expect(url.searchParams.get("code_challenge")).toBe(codeChallenge);
  return post("complete", {
    state: signed.request,
    verifier,
    code: "test-code"
  });
}

test("grants one tier at inclusive cutoffs and a base role for any ranked wallet", () => {
  expect(collectorRoleIds(config, 10)).toEqual([collector, top10]);
  expect(collectorRoleIds(config, 11)).toEqual([collector, top50]);
  expect(collectorRoleIds(config, 100)).toEqual([collector, top100]);
  expect(collectorRoleIds(config, 101)).toEqual([collector]);
  expect(collectorRoleIds(config, null)).toEqual([]);
});

test("requires wallet proof, the trusted origin and the same OAuth browser before linking", async () => {
  expect((await post("challenge", {}, "https://other.test")).status).toBe(403);
  const signed = await proof("link");
  const invalidVerifier = randomBytes(32).toString("base64url");
  const invalidSig = await otherWallet.signMessage({ message: "unrelated" });
  expect(
    (await post("start", { ...signed, signature: invalidSig, verifier })).status
  ).toBe(401);
  expect(
    (await post("start", { ...signed, verifier: invalidVerifier })).status
  ).toBe(401);
  expect((await post("start", { ...signed, verifier })).status).toBe(200);
  const callback = { state: signed.request, verifier, code: "test-code" };
  expect(
    (await post("complete", { ...callback, verifier: invalidVerifier })).status
  ).toBe(409);
  expect(send).not.toHaveBeenCalled();
  expect(await (await post("complete", callback)).json()).toEqual({
    status: "synced",
    rank: 7
  });
  expect(new Set(roles)).toEqual(new Set([community, collector, top10]));
  expect((await post("complete", callback)).status).toBe(409);
  expect((await connect(otherWallet)).status).toBe(409);
});

test("refreshes the tier, preserves roles during rank outages, and disconnects cleanly", async () => {
  await connect();
  rank = 38;
  await db.query("UPDATE discord_collector.links SET next_refresh_at = now()");
  expect(await service.refreshDue()).toBe(0);
  expect(roles).toEqual(new Set([community, collector, top50]));
  rankingUnavailable = true;
  const signed = await proof("refresh");
  expect((await post("refresh", signed)).status).toBe(503);
  expect(roles).toEqual(new Set([community, collector, top50]));
  expect((await post("refresh", signed)).status).toBe(401);
  const unlink = await post("unlink", await proof("unlink"));
  expect(await unlink.json()).toEqual({ status: "disconnected", rank: null });
  expect(roles).toEqual(new Set([community]));
  expect((await post("unlink", await proof("unlink"))).status).toBe(404);
});

test("connects a non-member and grants roles when they join and refresh", async () => {
  joined = false;
  const connection = await connect();
  expect(await connection.json()).toEqual({ status: "join_server", rank: 7 });
  joined = true;
  expect((await post("refresh", await proof("refresh"))).status).toBe(200);
  expect(roles).toEqual(new Set([community, collector, top10]));
  rank = null;
  expect(await (await post("refresh", await proof("refresh"))).json()).toEqual({
    status: "unranked",
    rank: null
  });
  expect(roles).toEqual(new Set([community]));
});
