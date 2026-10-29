import { arenaAbi } from "./arenaAbi";
import { arenaV2Abi } from "./arenaV2Abi";

export type ArenaContractVersion = 1 | 2;
export type ArenaMediaKind = "video" | "anime";

export function arenaMode(kind: ArenaMediaKind): 0 | 1 {
  if (kind === "video") return 0;
  if (kind === "anime") return 1;
  throw new Error("Unsupported Arena mode.");
}

export function arenaKind(mode: unknown): ArenaMediaKind {
  if (mode === 0 || mode === 0n || mode === "0") return "video";
  if (mode === 1 || mode === 1n || mode === "1") return "anime";
  throw new Error("Unsupported Arena mode.");
}

/** A shared contract has one canonical event stream. Its public mode and
 * tournament parity must agree before an event enters a mode-specific reader. */
export function arenaEventKind(
  args: Record<string, unknown>
): ArenaMediaKind | null {
  const declared = args.mode === undefined ? null : arenaKind(args.mode);
  if (args.id === undefined) return declared;
  const id = String(args.id);
  if (
    !/^[1-9][0-9]{0,77}$/.test(id) ||
    BigInt(id) >= 2n ** 256n ||
    (typeof args.id === "number" && !Number.isSafeInteger(args.id))
  )
    throw new Error("Invalid shared Arena tournament id.");
  const inferred = arenaKind((BigInt(id) - 1n) % 2n);
  if (declared !== null && declared !== inferred)
    throw new Error("Shared Arena event has an inconsistent mode.");
  return inferred;
}

export function arenaVersion(value: string | undefined): ArenaContractVersion {
  if (value === undefined || value === "1") return 1;
  if (value === "2") return 2;
  throw new Error("Unsupported Arena contract version.");
}

export function arenaContractAbi(version: ArenaContractVersion) {
  if (version === 1) return arenaAbi;
  if (version === 2) return arenaV2Abi;
  throw new Error("Unsupported Arena contract version.");
}

export function arenaDeploymentId(
  contract: string,
  kind: ArenaMediaKind = "video",
  version: ArenaContractVersion = 1
) {
  if (!/^0x[0-9a-f]{40}$/i.test(contract) || /^0x0{40}$/i.test(contract))
    throw new Error("Invalid Arena address.");
  arenaMode(kind);
  if (version !== 1 && version !== 2)
    throw new Error("Unsupported Arena contract version.");
  return `8453:${contract.toLowerCase()}${version === 2 ? `:${kind}` : ""}`;
}

export function parseArenaDeployment(deployment: string) {
  const match = /^8453:(0x[0-9a-f]{40})(?::(video|anime))?$/.exec(deployment);
  if (!match || /^0x0{40}$/.test(match[1]!))
    throw new Error("Invalid Arena deployment identity.");
  return {
    contract: match[1] as `0x${string}`,
    version: (match[2] ? 2 : 1) as ArenaContractVersion,
    mediaKind: (match[2] ?? "video") as ArenaMediaKind,
    canonicalPrefix: `8453:${match[1]}`
  };
}

export function nextArenaTournamentId(
  latest: string | undefined,
  kind: ArenaMediaKind,
  version: ArenaContractVersion
) {
  arenaMode(kind);
  if (version !== 1 && version !== 2)
    throw new Error("Unsupported Arena contract version.");
  if (!latest) return version === 2 ? BigInt(arenaMode(kind) + 1) : 1n;
  if (!/^[1-9][0-9]{0,77}$/.test(latest))
    throw new Error("Invalid Arena tournament id.");
  const id = BigInt(latest);
  if (id <= 0n || (version === 2 && Number((id - 1n) % 2n) !== arenaMode(kind)))
    throw new Error("Tournament belongs to another Arena mode.");
  const next = id + (version === 2 ? 2n : 1n);
  if (next >= 2n ** 256n) throw new Error("Arena tournament id overflow.");
  return next;
}
