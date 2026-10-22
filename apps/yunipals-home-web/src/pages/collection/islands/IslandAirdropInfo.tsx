import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { formatInteger, shortAddress } from "@/lib/format";
import {
  islandDetailHref,
  islandOwnerHref,
  type IslandToken
} from "@/lib/islandsIndexer";

export function IslandAirdropInfo({ token }: { token: IslandToken }) {
  if (!token.counterpart || !token.airdrop) return null;
  return (
    <section
      className="mt-5 rounded-card border border-line bg-white p-5"
      aria-label="Island airdrop provenance"
    >
      <h2 className="text-sm font-extrabold text-ink">
        Original &amp; Base airdrop
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        This pair comes from the Ethereum ownership snapshot on 6 August 2026,
        including eligible staked islands. Each NFT can belong to a different
        wallet. Transferring one does not transfer the other.
      </p>
      <Link
        to={islandDetailHref(
          token.counterpart.tokenId,
          token.counterpart.collectionId
        )}
        className="mt-4 inline-flex rounded-full border border-line px-4 py-2 text-sm font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
      >
        {token.collectionId === "base-islands-v2"
          ? "View Ethereum original"
          : "View Base airdrop"}{" "}
        #{token.tokenId}
      </Link>
      <dl className="mt-4 grid gap-3 text-xs text-muted sm:grid-cols-2">
        <div>
          <dt>Ethereum snapshot block</dt>
          <dd className="mt-1 font-bold text-ink">
            <a
              href={`https://etherscan.io/block/${token.airdrop.snapshotBlock}`}
              target="_blank"
              rel="noreferrer"
              className="underline focus-visible:ring-2 focus-visible:ring-ethereum"
            >
              {formatInteger(token.airdrop.snapshotBlock)}
            </a>
          </dd>
        </div>
        <div>
          <dt>Original airdrop recipient</dt>
          <dd className="mt-1 font-bold text-ink">
            <Link
              to={islandOwnerHref(token.airdrop.recipient, "base-islands-v2")}
              className="underline focus-visible:ring-2 focus-visible:ring-ethereum"
            >
              {shortAddress(token.airdrop.recipient)}
            </Link>
          </dd>
        </div>
      </dl>
      {token.replacement && (
        <div className="mt-4 rounded-2xl bg-mint/15 p-4 text-sm leading-relaxed text-muted">
          <p className="font-bold text-ink">Revealed Base replacement</p>
          <p className="mt-1">
            The first Base collection was replaced. This island was airdropped
            to its Base owner at snapshot block{" "}
            <a
              href={`https://basescan.org/block/${token.replacement.snapshotBlock}`}
              target="_blank"
              rel="noreferrer"
              className="underline focus-visible:ring-2 focus-visible:ring-ethereum"
            >
              {formatInteger(token.replacement.snapshotBlock)}
            </a>
            . Its token ID and published reveal assignment were preserved.
          </p>
          <p className="mt-2">
            Replacement recipient: {shortAddress(token.replacement.recipient)}
          </p>
          <a
            href={`https://basescan.org/tx/${token.replacement.mintTransactionHash}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-2 font-bold underline focus-visible:ring-2 focus-visible:ring-ethereum"
          >
            View replacement airdrop{" "}
            <ExternalLink aria-hidden="true" size={12} />
          </a>
          <a
            href={`https://basescan.org/token/${token.replacement.sourceContract}?a=${token.tokenId}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block text-xs underline focus-visible:ring-2 focus-visible:ring-ethereum"
          >
            View superseded Base NFT
          </a>
        </div>
      )}
      <a
        href={`https://basescan.org/tx/${token.airdrop.mintTransactionHash}`}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-muted underline focus-visible:ring-2 focus-visible:ring-ethereum"
      >
        View first Base airdrop <ExternalLink aria-hidden="true" size={12} />
      </a>
    </section>
  );
}
