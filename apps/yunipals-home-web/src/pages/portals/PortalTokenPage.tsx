import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { Link, useParams } from "react-router-dom";
import {
  portalColorNames,
  portalTypeNames
} from "@protopals/yunipals-market-core/portals";
import { environment } from "@/environment";
import { usePortalClaim } from "@/hooks/usePortalClaim";
import { readPortalClaim } from "@/lib/portalClaims";
import { portalImage, portalPrice, portalRange } from "@/lib/portals";
import { cn } from "@/lib/utils";
import { boosterButtonClass } from "@/pages/boosters/BoosterActionButton";
import { PortalActivityList } from "./PortalActivityList";
import {
  PortalClaimDialog,
  PortalClaimStatus,
  PortalWalletButton
} from "./PortalClaimDialog";

export function PortalTokenPage() {
  const { portalId = "" } = useParams();
  const claim = usePortalClaim();
  const client = usePublicClient({ chainId: environment.portalChainId });
  const query = useQuery({
    queryKey: ["portals", "token", environment.portalChainId, portalId],
    queryFn: async () => (await readPortalClaim(client!, portalId)).token,
    enabled: Boolean(client),
    refetchInterval: 6000
  });
  const token = query.data;
  const owner = Boolean(
    token && claim.address?.toLowerCase() === token.owner.toLowerCase()
  );
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap gap-5">
        <Link className="font-semibold underline" to="/portals/mine">
          ← My portals
        </Link>
        <Link className="font-semibold underline" to="/portals">
          Active portal
        </Link>
      </div>
      <h1 className="mt-6 font-display text-3xl">
        {token ? `${token.name} #${token.id}` : "Portal details"}
      </h1>
      {query.isPending ? (
        <div
          role="status"
          className="mt-6 h-64 animate-pulse rounded-card bg-lavender/20"
        >
          <span className="sr-only">Reading portal from the chain…</span>
        </div>
      ) : query.error ? (
        <p role="alert" className="mt-5">
          {query.error.message}{" "}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </p>
      ) : (
        token && (
          <div className="mt-7 grid gap-7 rounded-card border border-line p-5 sm:grid-cols-2 sm:p-8">
            <img
              src={portalImage(token.imageURI)}
              alt={`${token.name} #${token.id}`}
              className="mx-auto max-h-96 rounded-2xl object-contain"
            />
            <section>
              <h2 className="font-display text-2xl">
                {token.retired
                  ? "Portal redeemed"
                  : `${portalPrice(token.claimable)} USDC accumulated`}
              </h2>
              <p className="mt-3 text-muted">
                {token.retired
                  ? "This portal was permanently burned and cannot open again. Its public history remains below."
                  : "The entire balance belongs to this NFT. Only its current owner can burn it to withdraw."}
              </p>
              {!token.retired && (
                <p className="mt-3 break-all text-sm">Owner: {token.owner}</p>
              )}
              <dl className="mt-5 space-y-2 text-sm">
                <div>
                  <dt className="inline font-bold">Color: </dt>
                  <dd className="inline">
                    {portalColorNames[token.gates.colorGate]}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-bold">Type: </dt>
                  <dd className="inline">
                    {portalTypeNames[token.gates.typeGate]}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-bold">Sequence: </dt>
                  <dd className="inline">
                    {token.gates.originalOnly
                      ? "Original cards only"
                      : portalRange(
                          token.gates.sequenceStart,
                          token.gates.sequenceLength
                        )}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-bold">Glitter: </dt>
                  <dd className="inline">
                    {token.gates.glitterGate ? "Required" : "No restriction"}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-bold">Diamond: </dt>
                  <dd className="inline">
                    {token.gates.diamondGate ? "Required" : "No restriction"}
                  </dd>
                </div>
              </dl>
              <PortalWalletButton claim={claim} />
              {owner && !token.retired && (
                <button
                  type="button"
                  className={cn(boosterButtonClass, "mt-6")}
                  disabled={
                    claim.busy || claim.chainId !== environment.portalChainId
                  }
                  onClick={() => void claim.prepare(token.id)}
                >
                  Burn portal &amp; claim
                </button>
              )}
              {claim.address && !owner && !token.retired && (
                <p className="mt-4 text-sm text-muted">
                  Connect the current owner's wallet to redeem this portal.
                </p>
              )}
            </section>
          </div>
        )
      )}
      <PortalClaimStatus claim={claim} />
      {token && <PortalActivityList tokenId={token.id} />}
      <PortalClaimDialog claim={claim} />
    </main>
  );
}
