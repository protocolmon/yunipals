import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { isAddress } from "viem";
import { Sparkles, Trophy } from "lucide-react";
import { portalGradingAbi } from "@protopals/yunipals-market-core/portalAbi";
import { CardLightbox } from "@/components/CardLightbox";
import { environment } from "@/environment";
import { fetchPortalCard, portalImage, portalPrice } from "@/lib/portals";
import { shortAddress } from "@/lib/format";
import { cardArtworkCutoutStyle } from "@/lib/cardArtworkCutout";
import { cn } from "@/lib/utils";

type Leader = {
  entryId: string;
  requestId: string;
  submitter: string;
  score: number;
  amount: string;
  paid: boolean;
};

export function PortalCompetitionLeader({
  leader,
  rank,
  settled,
  owner
}: {
  leader: Leader | null;
  rank: number;
  settled: boolean;
  owner?: string;
}) {
  const [expandedArtwork, setExpandedArtwork] = useState<{
    name: string;
    image: string;
  } | null>(null);
  const client = usePublicClient({ chainId: environment.portalChainId });
  const grading = environment.portalGrading;
  const artwork = useQuery({
    queryKey: [
      "portals",
      "competition-artwork",
      environment.portalChainId,
      grading,
      leader?.requestId
    ],
    enabled: Boolean(client && leader && isAddress(grading)),
    queryFn: async () => {
      if (!client || !leader || !isAddress(grading)) return null;
      const request = await client.readContract({
        address: grading,
        abi: portalGradingAbi,
        functionName: "getRequest",
        args: [BigInt(leader.requestId)]
      });
      const tokenId = request.tokenId.toString();
      const card = await fetchPortalCard(tokenId);
      const slab = card.publication.find(
        (p) => p.requestId === leader.requestId
      )?.result.slab;
      return slab
        ? {
            tokenId,
            name: slab.cardName ?? `Card #${tokenId}`,
            image: slab.namedArtwork?.uri ?? slab.uri
          }
        : null;
    },
    staleTime: 60_000,
    refetchInterval: (query) => (query.state.data ? false : 8000),
    retry: 1
  });
  const place = ["1st", "2nd", "3rd"][rank - 1];
  if (!leader)
    return (
      <li className="flex min-h-28 flex-col items-center justify-center rounded-2xl border border-dashed border-lavender bg-lavender/5 p-3 text-center md:min-h-44 md:p-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-lavender/20 text-sm font-bold text-muted">
          {place}
        </span>
        <p className="mt-3 text-sm font-bold">Make it yours</p>
        <p className="mt-1 text-xs text-muted">Waiting for a graded spell</p>
      </li>
    );
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold",
            rank === 1 ? "bg-grape text-white" : "bg-lavender/30 text-grape"
          )}
        >
          <Trophy size={12} aria-hidden="true" />
          {place}
        </span>
        <p className="text-right">
          <strong className="font-display text-2xl text-grape">
            {(leader.score / 4).toFixed(1)}
          </strong>
          <span className="ml-1 text-xs text-muted">/ 100</span>
        </p>
      </div>
      <div className="mt-4 flex items-center gap-3">
        {artwork.data ? (
          <img
            src={portalImage(artwork.data.image)}
            style={cardArtworkCutoutStyle(artwork.data.image)}
            width={1024}
            height={1536}
            alt={artwork.data.name}
            className="card-artwork-cutout aspect-[2/3] h-auto w-20 shrink-0 object-contain drop-shadow-md"
            loading="lazy"
          />
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              "flex h-28 w-20 shrink-0 items-center justify-center rounded-xl bg-lavender/20 text-grape",
              artwork.isLoading && "motion-safe:animate-pulse"
            )}
          >
            <Sparkles />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="break-words font-display text-lg leading-snug">
            {artwork.data?.name ?? `Entry #${leader.entryId}`}
          </h3>
          <p
            className="mt-2 text-xs text-muted"
            title={leader.submitter}
            aria-label={`Submitted by ${leader.submitter}`}
          >
            {shortAddress(leader.submitter)}
            {owner?.toLowerCase() === leader.submitter.toLowerCase() && (
              <span className="ml-2 font-bold text-grape">You</span>
            )}
          </p>
          {artwork.data && (
            <span className="mt-2 inline-block text-xs font-bold text-grape underline underline-offset-2">
              View card →
            </span>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-1 border-t border-lavender/40 pt-3">
        <p className="font-bold">
          {portalPrice(leader.amount)}{" "}
          <span className="text-xs font-normal text-muted">USDC</span>
        </p>
        <span className="text-xs text-muted">
          {settled ? (leader.paid ? "Paid" : "Unpaid") : "Projected prize"}
        </span>
      </div>
    </>
  );
  return (
    <li
      className={cn(
        "relative col-span-2 rounded-2xl border shadow-sm md:col-span-1",
        rank === 1
          ? "border-lavender bg-gradient-to-br from-lavender/20 via-white to-sky/10"
          : "border-line bg-white"
      )}
    >
      <div className="p-4">{content}</div>
      {artwork.data && (
        <button
          type="button"
          aria-label={`View ${artwork.data.name} larger`}
          aria-haspopup="dialog"
          onClick={() => {
            if (artwork.data)
              setExpandedArtwork({
                name: artwork.data.name,
                image: portalImage(artwork.data.image)
              });
          }}
          className="absolute inset-0 h-full w-full cursor-zoom-in rounded-2xl transition-colors hover:bg-lavender/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape"
        />
      )}
      {expandedArtwork && (
        <CardLightbox
          artwork={expandedArtwork}
          label={expandedArtwork.name}
          onClose={() => setExpandedArtwork(null)}
        />
      )}
    </li>
  );
}
