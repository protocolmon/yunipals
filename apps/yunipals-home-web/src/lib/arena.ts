export type {
  Fighter,
  FrozenInput,
  LabCatalog,
  TournamentView
} from "../../../yunipals-market-api/src/arena/types";

export async function arenaRequest<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(`/api/arena/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal
  });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("Start the local Arena Lab server to try this flow.");
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.error === "string" ? result.error : "Arena request failed."
    );
  return result as T;
}

export function seatCredential(
  tournamentId: string,
  fighterId: string,
  create = false
) {
  const key = `yunipals-arena-lab:${tournamentId}:${fighterId}`;
  const existing = sessionStorage.getItem(key);
  if (existing || !create) return existing;
  const credential = Array.from(
    crypto.getRandomValues(new Uint8Array(32)),
    (value) => value.toString(16).padStart(2, "0")
  ).join("");
  sessionStorage.setItem(key, credential);
  return credential;
}
