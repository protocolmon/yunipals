import { environment } from "@/environment";

export type DiscordCollectorAction = "link" | "refresh" | "unlink";
export type DiscordCollectorResult = {
  status:
    | "synced"
    | "unranked"
    | "join_server"
    | "finish_screening"
    | "refresh_required"
    | "disconnected";
  rank: number | null;
};

const pendingKey = "yunipals:discord-oauth";
const callbackPath = "/discord/callback";
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const walletPattern = /^0x[0-9a-f]{40}$/i;
type Pending = { state: string; verifier: string; wallet: string };
let callback: URLSearchParams | undefined;
let completion:
  | Promise<{ wallet: string; result: DiscordCollectorResult }>
  | undefined;

export function captureDiscordCallback() {
  if (window.location.pathname !== callbackPath || !window.location.search)
    return;
  callback = new URLSearchParams(window.location.search);
  window.history.replaceState(window.history.state, "", callbackPath);
}

async function post<T>(path: string, body: object): Promise<T> {
  const response = await fetch(
    `${environment.yunipalsIndexerUrl}/v1/discord/collector/${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    }
  );
  if (!response.ok) {
    const { error } = await response.json().catch(() => ({}));
    const messages: Record<string, string> = {
      already_linked:
        "This Discord account or wallet already has a different connection. Disconnect the original wallet first.",
      discord_authorization_failed:
        "Discord couldn’t authorize this connection. Start again from your collection.",
      expired_request:
        "This request expired. Start again from your collection.",
      invalid_or_expired_signature:
        "The wallet signature is invalid or expired.",
      not_linked: "This wallet doesn’t have a Discord connection."
    };
    throw new Error(
      typeof error === "string" && Object.hasOwn(messages, error)
        ? messages[error]
        : "The Discord connection is temporarily unavailable. Try again."
    );
  }
  return response.json();
}

function base64Url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function requestDiscordWalletProof(
  wallet: string,
  action: DiscordCollectorAction
) {
  const verifier =
    action === "link"
      ? base64Url(crypto.getRandomValues(new Uint8Array(32)))
      : undefined;
  const codeChallenge = verifier
    ? base64Url(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(verifier)
          )
        )
      )
    : undefined;
  const proof = await post<{ request: string; message: string }>("challenge", {
    wallet,
    action,
    codeChallenge
  });
  return { ...proof, verifier };
}

export async function startDiscordConnection(
  wallet: string,
  request: string,
  signature: string,
  verifier: string
) {
  const { authorizeUrl } = await post<{ authorizeUrl: string }>("start", {
    request,
    signature,
    verifier
  });
  const destination = new URL(authorizeUrl);
  if (
    destination.origin !== "https://discord.com" ||
    destination.pathname !== "/oauth2/authorize"
  )
    throw new Error("The Discord authorization link is invalid.");
  const pending: Pending = { wallet, state: request, verifier };
  window.sessionStorage.setItem(pendingKey, JSON.stringify(pending));
  window.location.assign(destination);
}

export function updateDiscordConnection(
  action: "refresh" | "unlink",
  request: string,
  signature: string
) {
  return post<DiscordCollectorResult>(action, { request, signature });
}

export function completeDiscordConnection() {
  return (completion ??= (async () => {
    const stored = window.sessionStorage.getItem(pendingKey);
    window.sessionStorage.removeItem(pendingKey);
    const pending = stored
      ? (JSON.parse(stored) as Partial<Pending>)
      : undefined;
    const state = callback?.get("state");
    const code = callback?.get("code");
    const issuer = callback?.get("iss");
    const denied = callback?.get("error") === "access_denied";
    callback = undefined;
    if (denied) throw new Error("Discord connection canceled.");
    if (
      !pending?.wallet ||
      !walletPattern.test(pending.wallet) ||
      !pending.verifier ||
      !tokenPattern.test(pending.verifier) ||
      !state ||
      state !== pending.state ||
      !tokenPattern.test(state) ||
      !code ||
      (issuer && issuer !== "https://discord.com")
    )
      throw new Error(
        "This Discord request is missing or expired. Start again from your collection."
      );
    const result = await post<DiscordCollectorResult>("complete", {
      state,
      code,
      verifier: pending.verifier
    });
    return { wallet: pending.wallet, result };
  })());
}

export function discordCollectorMessage({
  status,
  rank
}: DiscordCollectorResult) {
  switch (status) {
    case "synced":
      return `Discord roles updated. Your overall Collector Score rank is #${rank?.toLocaleString()}.`;
    case "unranked":
      return "Discord connected. A wallet with an overall Collector Score rank qualifies for the collector role.";
    case "join_server":
      return "Discord connected. Join the server, then refresh your collector roles.";
    case "finish_screening":
      return "Discord connected. Finish the server’s membership screening, then refresh your collector roles.";
    case "refresh_required":
      return "Discord connected. Role updates are temporarily unavailable. Refresh your collector roles from your collection.";
    case "disconnected":
      return "Discord disconnected and collector roles removed.";
  }
}
