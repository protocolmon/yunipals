import {
  erc721Abi,
  type Address,
  type LocalAccount,
  type PublicClient
} from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import {
  ARENA_ENTRY_TYPES,
  arenaDomain,
  supportedArenaNft
} from "@protopals/yunipals-market-core/arena";
import { readConfirmedBlock } from "@/confirmations";
import { ArenaIntake, ArenaRequestError } from "./intake";

export type AdmissionRequest = {
  nftChainId: number;
  collection: Address;
  tokenId: string;
};
export function createAdmission(
  service: ArenaIntake,
  signer: LocalAccount,
  clients: ReadonlyMap<number, PublicClient>,
  ensureIdentity: (
    id: string,
    nft: AdmissionRequest,
    wallet: Address
  ) => Promise<unknown>
) {
  return async (id: string, wallet: Address, nft: AdmissionRequest) => {
    await service.ready();
    if (
      !supportedArenaNft(nft.nftChainId, nft.collection) ||
      !/^(0|[1-9][0-9]{0,77})$/.test(nft.tokenId) ||
      BigInt(nft.tokenId) >= 2n ** 256n
    )
      throw new ArenaRequestError(
        400,
        "Choose a Yunipal from a supported collection."
      );
    const state = await service.state(id);
    if (
      state.phase !== "open" ||
      state.seats.length >= 4 ||
      (state.deadline !== 0 && state.deadline * 1000 <= Date.now() + 60_000)
    )
      throw new ArenaRequestError(
        409,
        "This lobby is no longer accepting entries."
      );
    const source = clients.get(nft.nftChainId),
      base = clients.get(8453);
    if (!source || !base)
      throw new ArenaRequestError(
        503,
        "Ownership verification is temporarily unavailable."
      );
    const ownershipBlock = await readConfirmedBlock(source, nft.nftChainId);
    const owner = await source.readContract({
      address: nft.collection,
      abi: erc721Abi,
      functionName: "ownerOf",
      args: [BigInt(nft.tokenId)],
      blockNumber: ownershipBlock.number
    });
    if (owner.toLowerCase() !== wallet.toLowerCase())
      throw new ArenaRequestError(
        403,
        "This wallet does not own that NFT at the confirmed ownership snapshot."
      );
    // Identity must be usable before an entry permit can authorize a payment.
    await ensureIdentity(id, nft, wallet);
    const current = await base.getBlock({ blockTag: "latest" });
    if (Math.abs(Number(current.timestamp) * 1000 - Date.now()) > 120_000)
      throw new ArenaRequestError(
        503,
        "Base is catching up. Please try again shortly."
      );
    const [live, paused] = await Promise.all([
      base.readContract({
        address: service.contract,
        abi: arenaAbi,
        functionName: "tournament",
        args: [BigInt(id)],
        blockNumber: current.number
      }),
      base.readContract({
        address: service.contract,
        abi: arenaAbi,
        functionName: "entriesPaused",
        blockNumber: current.number
      })
    ]);
    if (
      paused ||
      live.phase !== 1 ||
      live.count >= 4 ||
      (live.deadline !== 0n && live.deadline <= current.timestamp + 60n)
    )
      throw new ArenaRequestError(
        409,
        "Entries are paused or this lobby has filled."
      );
    const expiry = current.timestamp + 480n;
    const entry = {
      player: wallet,
      nftChainId: BigInt(nft.nftChainId),
      collection: nft.collection,
      tokenId: BigInt(nft.tokenId)
    };
    const signature = await signer.signTypedData({
      domain: arenaDomain(service.contract),
      types: ARENA_ENTRY_TYPES,
      primaryType: "EntryPermit",
      message: { tournamentId: BigInt(id), ...entry, expiry }
    });
    await service.pool.query(
      `INSERT INTO yunipals_arena.admission(deployment,tournament_id,wallet,nft_chain_id,collection,token_id,ownership_block,ownership_hash,expiry,signature)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [
        service.deployment,
        id,
        wallet.toLowerCase(),
        nft.nftChainId,
        nft.collection.toLowerCase(),
        nft.tokenId,
        ownershipBlock.number.toString(),
        ownershipBlock.hash,
        expiry.toString(),
        signature
      ]
    );
    return {
      entry: { ...entry, nftChainId: nft.nftChainId, tokenId: nft.tokenId },
      expiry: expiry.toString(),
      signature,
      ownershipBlock: ownershipBlock.number.toString()
    };
  };
}
