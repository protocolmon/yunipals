import {
  erc721Abi,
  type Address,
  type LocalAccount,
  type PublicClient
} from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { withArenaSourceLease } from "./sourceSelection";
import {
  ARENA_ENTRY_TYPES,
  arenaDomain,
  supportedArenaNft
} from "@protopals/yunipals-market-core/arena";
import { ArenaIntake, ArenaRequestError } from "./intake";
import { transaction } from "@/db/pool";
import { verifyNativeArenaAction } from "./nativeAction";

export type AdmissionRequest = {
  nftChainId: number;
  collection: Address;
  tokenId: string;
  incarnation?: string;
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
  return async (id: string, wallet: Address, nft: AdmissionRequest) =>
    withArenaSourceLease(service, async () => {
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
      const before = await service.tournamentContext(id),
        state = before.state;
      if (
        service.nativeSource &&
        nft.incarnation !== undefined &&
        nft.incarnation !== before.incarnation
      )
        throw new ArenaRequestError(
          409,
          "The tournament opening changed. Refresh before trying again."
        );
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
      const ownershipBlock = await source.getBlock({
        blockTag:
          service.nativeSource && nft.nftChainId === 8453
            ? "latest"
            : "finalized"
      });
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
      const observed = await service.tournamentContext(
        id,
        service.pool,
        false,
        before.incarnation
      );
      if (service.nativeSource)
        await verifyNativeArenaAction(base, observed.observation!);
      const signature = await signer.signTypedData({
        domain: arenaDomain(service.contract),
        types: ARENA_ENTRY_TYPES,
        primaryType: "EntryPermit",
        message: { tournamentId: BigInt(id), ...entry, expiry }
      });
      await transaction(service.pool, async (db) => {
        await service.ready(db);
        const context = await service.tournamentContext(
          id,
          db,
          true,
          before.incarnation
        );
        if (context.state.phase !== "open" || context.state.seats.length >= 4)
          throw new ArenaRequestError(
            409,
            "This lobby is no longer accepting entries."
          );
        await db.query(
          `INSERT INTO yunipals_arena.admission(deployment,tournament_id,wallet,nft_chain_id,collection,token_id,ownership_block,ownership_hash,expiry,signature,incarnation)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
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
            signature,
            context.incarnation
          ]
        );
      });
      return {
        entry: { ...entry, nftChainId: nft.nftChainId, tokenId: nft.tokenId },
        expiry: expiry.toString(),
        signature,
        ownershipBlock: ownershipBlock.number.toString(),
        ...(service.nativeSource ? { incarnation: before.incarnation } : {})
      };
    });
}
