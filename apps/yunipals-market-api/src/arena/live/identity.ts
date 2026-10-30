import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";
import { supportedArenaNft } from "@protopals/yunipals-market-core/arena";
import { canonicalJson, sha256 } from "../draw";
import type { Fighter } from "../types";
import type { AdmissionRequest } from "./admission";
import { ArenaRequestError } from "./intake";
import type {
  AnimeKnownKit,
  AnimeLoadout
} from "@protopals/yunipals-market-core/anime";

const chains: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  56: "bnb",
  137: "polygon"
};
export type IdentityProfile = Pick<
  Fighter,
  "species" | "identity" | "locomotion" | "image"
> & {
  color: string;
  horn: string;
  imageSha256: string;
  source?: "artwork-analysis-v1";
};
export type FighterSnapshot = Fighter & {
  chainId: number;
  collection: string;
  color: string;
  horn: string;
  imageSha256: string;
  metadataSha256: string;
  identityProfileSha256: string;
  identityVersion:
    | "reviewed-artwork-v1"
    | "artwork-analysis-v1"
    | "anime-fighter-v1";
  animeManifestHash?: string;
  animeRecipeHash?: string;
  animeKits?: AnimeKnownKit[];
  animeDefaultLoadout?: AnimeLoadout;
};

/** Indexer metadata is data, never prompt instructions. Only reviewed image-bound
 * anatomy enters the referee. Artwork variants do not inherit wings by name. */
export function compileIdentity(
  nft: AdmissionRequest,
  payload: unknown,
  profiles: IdentityProfile[]
): FighterSnapshot {
  const { token, species, color, horn } = identityMetadata(nft, payload);
  const profile = profiles.find(
    (p) =>
      p.image === token.image &&
      p.species === species &&
      p.color === color &&
      p.horn === horn
  );
  if (!profile)
    throw new ArenaRequestError(
      409,
      "This artwork still needs its anatomy checked before arena entry. No payment has been requested."
    );
  const chain = chains[nft.nftChainId]!;
  const metadata = {
    chainId: nft.nftChainId,
    collection: nft.collection.toLowerCase(),
    tokenId: nft.tokenId,
    species,
    color,
    horn,
    image: profile.image
  };
  return {
    id: `nft-${nft.nftChainId}-${nft.collection.toLowerCase()}-${nft.tokenId}`,
    name: `${species} #${nft.tokenId}`,
    tokenId: nft.tokenId,
    chain,
    chainId: nft.nftChainId,
    collection: nft.collection.toLowerCase(),
    species,
    color,
    horn,
    identity: profile.identity,
    image: profile.image,
    imageSha256: profile.imageSha256,
    sourcePage: `https://www.yunipals.com/collection/${chain}/${nft.tokenId}`,
    locomotion: profile.locomotion,
    metadataSha256: sha256(canonicalJson(metadata)),
    identityProfileSha256: sha256(canonicalJson(profile)),
    identityVersion: profile.source ?? "reviewed-artwork-v1"
  };
}

export function identityMetadata(nft: AdmissionRequest, payload: unknown) {
  if (
    !supportedArenaNft(nft.nftChainId, nft.collection) ||
    !/^[1-9][0-9]{0,77}$/.test(nft.tokenId) ||
    BigInt(nft.tokenId) >= 2n ** 256n
  )
    throw new ArenaRequestError(400, "Choose a supported Yunipal NFT.");
  const token = (payload as { token?: Record<string, unknown> } | null)?.token;
  if (
    !token ||
    token.chain_id !== nft.nftChainId ||
    token.chain !== chains[nft.nftChainId] ||
    token.token_id !== nft.tokenId ||
    typeof token.contract_address !== "string" ||
    token.contract_address.toLowerCase() !== nft.collection.toLowerCase() ||
    !Array.isArray(token.attributes)
  )
    throw new ArenaRequestError(
      503,
      "NFT metadata is incomplete or belongs to a different token."
    );
  const trait = (name: string) => {
    const entries = (
      token.attributes as Array<{ trait_type?: unknown; value?: unknown }>
    ).filter((a) => a?.trait_type === name);
    if (entries.length !== 1 || typeof entries[0]?.value !== "string")
      throw new ArenaRequestError(
        503,
        "NFT identity traits are missing or ambiguous."
      );
    if (
      entries[0].value.length > 100 ||
      /[\u0000-\u001f]/.test(entries[0].value)
    )
      throw new ArenaRequestError(503, "NFT identity traits are invalid.");
    return entries[0].value;
  };
  const species = trait("Type"),
    color = trait("Color"),
    horn = trait("Horn");
  if (
    typeof token.image !== "string" ||
    !/^https:\/\/drive\.polychainmonsters\.com\/ipfs\/[A-Za-z0-9]+$/.test(
      token.image
    )
  )
    throw new ArenaRequestError(
      503,
      "NFT artwork must use the official image gateway."
    );
  return { token, species, color, horn, image: token.image };
}

export function loadIdentityProfiles(root: string) {
  const data = JSON.parse(
    readFileSync(
      join(root, "docs/arena/identity-registry-v1/profiles.json"),
      "utf8"
    )
  ) as { version: string; profiles: IdentityProfile[] };
  if (data.version !== "reviewed-artwork-v1" || !Array.isArray(data.profiles))
    throw new Error("Unsupported identity registry.");
  const images = new Set<string>();
  for (const p of data.profiles) {
    if (
      !/^https:\/\/drive\.polychainmonsters\.com\/ipfs\/[A-Za-z0-9]+$/.test(
        p.image
      ) ||
      !/^[0-9a-f]{64}$/.test(p.imageSha256) ||
      !["ground", "flight"].includes(p.locomotion) ||
      !p.identity ||
      p.identity.length > 1500 ||
      !p.species ||
      !p.color ||
      !p.horn ||
      images.has(p.image)
    )
      throw new Error("Invalid or duplicate reviewed identity profile.");
    images.add(p.image);
  }
  return data.profiles;
}

export function indexerMetadata(
  fetcher: typeof fetch = fetch,
  baseUrl = "https://api.yunipals.com/yunipals-indexer"
) {
  if (
    ![
      "https://api.yunipals.com/yunipals-indexer",
      "http://127.0.0.1:9011"
    ].includes(baseUrl)
  )
    throw new Error(
      "Arena metadata requires the configured official indexer endpoint."
    );
  return async (nft: AdmissionRequest): Promise<unknown> => {
    if (
      !supportedArenaNft(nft.nftChainId, nft.collection) ||
      !/^[1-9][0-9]{0,77}$/.test(nft.tokenId)
    )
      throw new Error("Unsupported NFT.");
    const response = await fetcher(
      `${baseUrl}/v1/tokens/${chains[nft.nftChainId]}/${nft.tokenId}`,
      {
        headers: {
          Origin: "https://www.yunipals.com",
          Accept: "application/json"
        },
        redirect: "error",
        signal: AbortSignal.timeout(10000)
      }
    );
    if (!response.ok || !response.body)
      throw new ArenaRequestError(
        503,
        "NFT metadata is temporarily unavailable."
      );
    // Bound streamed responses as well as Content-Length. Do not fetch token-supplied URLs.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 65536) throw new Error("NFT metadata exceeds size limit.");
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
}

export class ArenaIdentities {
  private readonly pending = new Map<string, Promise<FighterSnapshot>>();
  constructor(
    private readonly pool: Pool,
    private readonly deployment: string,
    private readonly profiles: IdentityProfile[],
    private readonly load: (nft: AdmissionRequest) => Promise<unknown>,
    private readonly context?: (id: string) => Promise<{ incarnation: string }>,
    private readonly resolve?: (
      nft: AdmissionRequest,
      payload: unknown,
      wallet?: string
    ) => Promise<IdentityProfile>,
    private readonly compile?: (
      nft: AdmissionRequest
    ) => Promise<FighterSnapshot>
  ) {}

  private async selected(id: string, expectedIncarnation?: string) {
    const incarnation = (await this.context?.(id))?.incarnation ?? "legacy";
    if (
      expectedIncarnation !== undefined &&
      incarnation !== expectedIncarnation
    )
      throw new ArenaRequestError(
        409,
        "The tournament opening changed during NFT preparation."
      );
    return incarnation;
  }

  async read(id: string, nft: AdmissionRequest, expectedIncarnation?: string) {
    return this.readAt(id, nft, await this.selected(id, expectedIncarnation));
  }
  private async readAt(id: string, nft: AdmissionRequest, incarnation: string) {
    const row = (
      await this.pool.query<{
        snapshot: FighterSnapshot;
        snapshot_hash: string;
      }>(
        `SELECT snapshot,snapshot_hash FROM yunipals_arena.fighter_snapshot
       WHERE deployment=$1 AND tournament_id=$2 AND nft_chain_id=$3 AND collection=$4 AND token_id=$5 AND incarnation=$6`,
        [
          this.deployment,
          id,
          nft.nftChainId,
          nft.collection.toLowerCase(),
          nft.tokenId,
          incarnation
        ]
      )
    ).rows[0];
    if (!row) return null;
    if (
      sha256(canonicalJson(row.snapshot)) !== row.snapshot_hash ||
      row.snapshot.chainId !== nft.nftChainId ||
      row.snapshot.collection !== nft.collection.toLowerCase() ||
      row.snapshot.tokenId !== nft.tokenId
    )
      throw new Error("Stored NFT identity checksum mismatch.");
    return row.snapshot;
  }

  async ensure(
    id: string,
    nft: AdmissionRequest,
    expectedIncarnation?: string,
    wallet?: string
  ) {
    const incarnation = await this.selected(id, expectedIncarnation);
    const prior = await this.readAt(id, nft, incarnation);
    if (prior) return prior;
    const key = `${id}/${incarnation}/${nft.nftChainId}/${nft.collection.toLowerCase()}/${nft.tokenId}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const work = this.create(id, nft, incarnation, wallet);
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }

  private async create(
    id: string,
    nft: AdmissionRequest,
    incarnation: string,
    wallet?: string
  ) {
    const snapshot = this.compile
      ? await this.compile(nft)
      : await (async () => {
          const payload = await this.load(nft);
          const metadata = identityMetadata(nft, payload);
          const known = this.profiles.some(
            (p) =>
              p.image === metadata.image &&
              p.species === metadata.species &&
              p.color === metadata.color &&
              p.horn === metadata.horn
          );
          const profiles =
            known || !this.resolve
              ? this.profiles
              : [await this.resolve(nft, payload, wallet)];
          return compileIdentity(nft, payload, profiles);
        })();
    if (((await this.context?.(id))?.incarnation ?? "legacy") !== incarnation)
      throw new ArenaRequestError(
        409,
        "The tournament opening changed during NFT preparation."
      );
    // First snapshot wins across processes too. Later metadata or profile changes
    // cannot change the identity players already saw in this tournament.
    await this.pool.query(
      `INSERT INTO yunipals_arena.fighter_snapshot(deployment,tournament_id,nft_chain_id,collection,token_id,snapshot,snapshot_hash,incarnation)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [
        this.deployment,
        id,
        nft.nftChainId,
        nft.collection.toLowerCase(),
        nft.tokenId,
        snapshot,
        sha256(canonicalJson(snapshot)),
        incarnation
      ]
    );
    return (await this.readAt(id, nft, incarnation))!;
  }
}
