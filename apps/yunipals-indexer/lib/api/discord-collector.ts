import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Pool, PoolClient } from "pg";
import { verifyMessage, type Address } from "viem";
import { z } from "zod";

const snowflake = z.string().regex(/^[1-9][0-9]{16,19}$/);
const walletAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase() as Address);
const opaqueToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const actionSchema = z.enum(["link", "refresh", "unlink"]);
type Action = z.infer<typeof actionSchema>;
const proofSchema = z.object({
  request: opaqueToken,
  signature: z.string().regex(/^0x[0-9a-fA-F]{128}([0-9a-fA-F]{2})?$/)
});
const tierSchema = z.object({
  maxRank: z.number().int().positive().safe(),
  roleId: snowflake
});

export function discordCollectorConfig(env: NodeJS.ProcessEnv) {
  if (env.DISCORD_COLLECTOR_ENABLED !== "true") return null;
  const settings = z
    .object({
      clientId: snowflake,
      guildId: snowflake,
      collectorRoleId: snowflake,
      botToken: z.string().min(1),
      databaseUrl: z.string().min(1),
      redirectUri: z.string().url(),
      tiers: z.array(tierSchema).max(10)
    })
    .safeParse({
      clientId: env.DISCORD_COLLECTOR_CLIENT_ID,
      guildId: env.DISCORD_COLLECTOR_GUILD_ID,
      collectorRoleId: env.DISCORD_COLLECTOR_ROLE_ID,
      botToken: env.DISCORD_COLLECTOR_BOT_TOKEN,
      databaseUrl: env.DISCORD_COLLECTOR_DATABASE_URL,
      redirectUri: env.DISCORD_COLLECTOR_REDIRECT_URI,
      tiers: JSON.parse(env.DISCORD_COLLECTOR_TIERS ?? "[]")
    });
  if (!settings.success)
    throw new Error("Invalid Discord collector configuration");
  const config = settings.data;
  const redirect = new URL(config.redirectUri);
  const local =
    redirect.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(redirect.hostname);
  if (
    (!local && redirect.protocol !== "https:") ||
    redirect.pathname !== "/discord/callback" ||
    redirect.search ||
    redirect.hash ||
    redirect.username ||
    redirect.password
  )
    throw new Error("Invalid Discord collector callback URL");
  const ids = [
    config.guildId,
    config.collectorRoleId,
    ...config.tiers.map((tier) => tier.roleId)
  ];
  if (
    new Set(ids).size !== ids.length ||
    new Set(config.tiers.map((tier) => tier.maxRank)).size !==
      config.tiers.length
  )
    throw new Error(
      "Discord collector role IDs and tier cutoffs must be distinct"
    );
  return {
    ...config,
    origin: redirect.origin,
    tiers: config.tiers.sort((left, right) => left.maxRank - right.maxRank)
  };
}

type Config = NonNullable<ReturnType<typeof discordCollectorConfig>>;
type RequestRow = { wallet: Address; code_challenge: string | null };
type Link = { discord_id: string };
type SyncStatus = "synced" | "unranked" | "join_server" | "finish_screening";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
const nonce = () => randomBytes(32).toString("base64url");

function signingMessage(
  origin: string,
  wallet: Address,
  action: Action,
  request: string,
  challenge: string | null
) {
  const descriptions = {
    link: "Connect Discord to this Yunipals wallet",
    refresh: "Refresh this wallet's Yunipals Discord roles",
    unlink: "Disconnect Discord from this Yunipals wallet"
  };
  const browserBinding = challenge
    ? `\nDiscord browser challenge: ${challenge}`
    : "";
  return `${descriptions[action]}\n\nSite: ${origin}\nWallet: ${wallet}\nOne-time request: ${request}${browserBinding}\n\nThis signature does not send a transaction or approve any assets.`;
}

export function collectorRoleIds(
  config: Pick<Config, "collectorRoleId" | "tiers">,
  rank: number | null
) {
  if (rank === null) return [];
  const tier = config.tiers.find(({ maxRank }) => rank <= maxRank);
  return tier
    ? [config.collectorRoleId, tier.roleId]
    : [config.collectorRoleId];
}

export function discordCollectorRoutes(
  config: Config,
  db: Pick<Pool, "query" | "connect">,
  getRank: (wallet: Address) => Promise<number | null>,
  fetcher: typeof fetch = fetch
) {
  const routes = new Hono();
  const managedIds = [
    config.collectorRoleId,
    ...config.tiers.map((tier) => tier.roleId)
  ];
  const guildPath = `/guilds/${config.guildId}`;
  async function discord(
    path: string,
    authorization: string,
    options: RequestInit = {}
  ) {
    return fetcher(`https://discord.com/api/v10${path}`, {
      ...options,
      headers: { ...options.headers, Authorization: authorization },
      redirect: "error",
      signal: AbortSignal.timeout(5_000)
    });
  }

  function bot(path: string, method = "GET") {
    return discord(`${guildPath}${path}`, `Bot ${config.botToken}`, { method });
  }

  async function updateRoles(
    id: string,
    desired: string[]
  ): Promise<SyncStatus> {
    const memberPath = `/members/${id}`;
    const result = await bot(memberPath);
    if (result.status === 404 && (await result.json()).code === 10007)
      return "join_server";
    if (!result.ok) throw new Error("Discord member lookup failed");
    const member = z
      .object({ roles: z.array(snowflake), pending: z.boolean().optional() })
      .parse(await result.json());
    if (desired.length && member.pending) return "finish_screening";
    const remove = managedIds.filter(
      (role) => member.roles.includes(role) && !desired.includes(role)
    );
    const add = desired.filter((role) => !member.roles.includes(role));
    const changed = [...remove, ...add];
    if (changed.length) {
      const response = await bot("/roles");
      if (!response.ok) throw new Error("Discord roles lookup failed");
      const roles = z
        .array(
          z.object({
            id: snowflake,
            permissions: z.string(),
            managed: z.boolean()
          })
        )
        .parse(await response.json());
      if (
        changed.some(
          (id) =>
            !roles.some(
              (role) =>
                role.id === id && role.permissions === "0" && !role.managed
            )
        )
      )
        throw new Error(
          "A collector role is missing or grants server permissions"
        );
    }
    for (const [method, ids] of [
      ["DELETE", remove],
      ["PUT", add]
    ] as const) {
      for (const id of ids) {
        const response = await bot(`${memberPath}/roles/${id}`, method);
        if (!response.ok) throw new Error("Discord role update failed");
      }
    }
    return desired.length ? "synced" : "unranked";
  }

  async function withLink<T>(
    wallet: Address,
    run: (id: string, client: PoolClient) => Promise<T>
  ) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<Link>(
        "SELECT discord_id FROM discord_collector.links WHERE wallet = $1 FOR UPDATE",
        [wallet]
      );
      const link = found.rows[0];
      const result = link ? await run(link.discord_id, client) : null;
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  function sync(wallet: Address) {
    return withLink(wallet, async (id, client) => {
      const rank = await getRank(wallet);
      const status = await updateRoles(id, collectorRoleIds(config, rank));
      await client.query(
        `UPDATE discord_collector.links
         SET next_refresh_at = now() + interval '1 day' WHERE wallet = $1`,
        [wallet]
      );
      return { status, rank };
    });
  }

  async function refreshDue() {
    await db.query("DELETE FROM discord_collector.requests WHERE expires_at <= now()");
    const due = await db.query<{ wallet: Address }>(
      `UPDATE discord_collector.links SET next_refresh_at = now() + interval '15 minutes'
       WHERE wallet IN (
         SELECT wallet FROM discord_collector.links WHERE next_refresh_at <= now()
         ORDER BY next_refresh_at, wallet LIMIT 8 FOR UPDATE SKIP LOCKED
       ) RETURNING wallet`
    );
    let failures = 0;
    for (const { wallet } of due.rows) {
      try {
        await sync(wallet);
      } catch {
        failures++;
      }
    }
    return failures;
  }

  async function verifyProof(
    request: string,
    signature: `0x${string}`,
    action: Action
  ) {
    const result = await db.query<RequestRow>(
      `SELECT wallet, code_challenge FROM discord_collector.requests
       WHERE id_hash = $1 AND action = $2 AND expires_at > now() AND NOT oauth_started`,
      [hash(request), action]
    );
    const row = result.rows[0];
    return row &&
      (await verifyMessage({
        address: row.wallet,
        message: signingMessage(
          config.origin,
          row.wallet,
          action,
          request,
          row.code_challenge
        ),
        signature
      }).catch(() => false))
      ? row
      : null;
  }

  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (c.req.header("Origin") !== config.origin)
      return c.json({ error: "invalid_origin" }, 403);
    await next();
  });
  routes.use("*", bodyLimit({ maxSize: 2_048 }));
  routes.onError((_error, c) =>
    c.json({ error: "discord_connection_unavailable" }, 503)
  );

  routes.post("/challenge", async (c) => {
    const body = z
      .object({
        wallet: walletAddress,
        action: actionSchema,
        codeChallenge: opaqueToken.optional()
      })
      .refine(
        ({ action, codeChallenge }) =>
          (action === "link") === Boolean(codeChallenge)
      )
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    const { wallet, action, codeChallenge = null } = body.data;
    const request = nonce();
    await db.query(
      `INSERT INTO discord_collector.requests (id_hash, wallet, action, expires_at, code_challenge)
       VALUES ($1, $2, $3, now() + interval '5 minutes', $4)`,
      [hash(request), wallet, action, codeChallenge]
    );
    return c.json({
      request,
      message: signingMessage(
        config.origin,
        wallet,
        action,
        request,
        codeChallenge
      )
    });
  });

  routes.post("/start", async (c) => {
    const body = proofSchema
      .extend({ verifier: opaqueToken })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    const { request, verifier, signature } = body.data;
    const codeChallenge = hash(verifier);
    const proof = await verifyProof(
      request,
      signature as `0x${string}`,
      "link"
    );
    if (proof?.code_challenge !== codeChallenge)
      return c.json({ error: "invalid_or_expired_signature" }, 401);
    const claim = await db.query(
      `UPDATE discord_collector.requests SET oauth_started = true, expires_at = now() + interval '10 minutes'
       WHERE id_hash = $1 AND code_challenge = $2 AND NOT oauth_started AND expires_at > now()`,
      [hash(request), codeChallenge]
    );
    if (!claim.rowCount) return c.json({ error: "expired_request" }, 409);
    const url = new URL("https://discord.com/oauth2/authorize");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      scope: "identify",
      response_type: "code",
      redirect_uri: config.redirectUri,
      state: request,
      code_challenge: codeChallenge,
      code_challenge_method: "S256"
    }).toString();
    return c.json({ authorizeUrl: url.toString() });
  });

  routes.post("/complete", async (c) => {
    const body = z
      .object({
        state: opaqueToken,
        verifier: opaqueToken,
        code: z.string().min(1).max(256)
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    const { state, verifier, code } = body.data;
    const claim = await db.query<RequestRow>(
      `DELETE FROM discord_collector.requests WHERE id_hash = $1 AND code_challenge = $2
       AND action = 'link' AND oauth_started AND expires_at > now() RETURNING wallet`,
      [hash(state), hash(verifier)]
    );
    const wallet = claim.rows[0]?.wallet;
    if (!wallet) return c.json({ error: "expired_request" }, 409);
    const tokenResponse = await fetcher(
      "https://discord.com/api/v10/oauth2/token",
      {
        method: "POST",
        body: new URLSearchParams({
          client_id: config.clientId,
          grant_type: "authorization_code",
          code,
          redirect_uri: config.redirectUri,
          code_verifier: verifier
        }),
        redirect: "error",
        signal: AbortSignal.timeout(5_000)
      }
    );
    if (!tokenResponse.ok)
      return c.json({ error: "discord_authorization_failed" }, 400);
    const token = z
      .object({ access_token: z.string().min(1) })
      .parse(await tokenResponse.json());
    const userResponse = await discord(
      "/users/@me",
      `Bearer ${token.access_token}`
    );
    if (!userResponse.ok)
      return c.json({ error: "discord_authorization_failed" }, 400);
    const { id } = z.object({ id: snowflake }).parse(await userResponse.json());
    try {
      const link = await db.query(
        `INSERT INTO discord_collector.links (wallet, discord_id) VALUES ($1, $2)
         ON CONFLICT (wallet) DO UPDATE SET discord_id = EXCLUDED.discord_id
         WHERE discord_collector.links.discord_id = EXCLUDED.discord_id`,
        [wallet, id]
      );
      if (!link.rowCount) return c.json({ error: "already_linked" }, 409);
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        error.code === "23505"
      )
        return c.json({ error: "already_linked" }, 409);
      throw error;
    }
    const result = await sync(wallet).catch(() => null);
    return c.json(result ?? { status: "refresh_required", rank: null });
  });

  for (const action of ["refresh", "unlink"] as const) {
    routes.post(`/${action}`, async (c) => {
      const body = proofSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "invalid_request" }, 400);
      const { request, signature } = body.data;
      const proof = await verifyProof(
        request,
        signature as `0x${string}`,
        action
      );
      if (!proof) return c.json({ error: "invalid_or_expired_signature" }, 401);
      const { wallet } = proof;
      const claim = await db.query(
        `DELETE FROM discord_collector.requests WHERE id_hash = $1 AND action = $2
         AND expires_at > now() AND code_challenge IS NULL`,
        [hash(request), action]
      );
      if (!claim.rowCount) return c.json({ error: "expired_request" }, 409);
      const result =
        action === "refresh"
          ? await sync(wallet)
          : await withLink(wallet, async (id, client) => {
              await updateRoles(id, []);
              await client.query(
                "DELETE FROM discord_collector.links WHERE wallet = $1",
                [wallet]
              );
              return { status: "disconnected", rank: null };
            });
      return result ? c.json(result) : c.json({ error: "not_linked" }, 404);
    });
  }
  return { routes, refreshDue };
}
