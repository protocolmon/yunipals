import { Link } from "react-router-dom";
import { useAccount } from "wagmi";

import { collectorHref } from "@/lib/collectionEdition";

export function AnimeApplicationHint() {
  const { address } = useAccount();

  return (
    <aside
      aria-label="How to apply for Anime Arena"
      className="my-6 grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3 rounded-card border border-lavender bg-lavender/10 p-5 sm:grid-cols-[7rem_minmax(0,1fr)]"
    >
      <figure className="sm:row-span-2">
        <img
          src="/images/arena/anime-chick.webp"
          alt="Yunichick anime fighter preview"
          width={455}
          height={600}
          loading="lazy"
          className="h-auto w-full"
        />
        <figcaption className="mt-1 text-center text-xs text-muted">
          Fighter preview
        </figcaption>
      </figure>
      <h3 className="self-center text-lg font-bold">
        Apply before your first anime battle
      </h3>
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <p className="text-sm leading-relaxed text-muted">
          Open a Base OG Yunipal in your OG Airdrop collection and choose Anime
          Arena → Apply. Applying costs Base gas only. Your fighter appears here
          after artwork review and approval.
        </p>
        <p className="mt-2 text-sm text-muted">
          Monsters on Polygon, BNB or Ethereum, and TCG cards, cannot enter
          Anime Arena.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm font-semibold">
          <Link
            to={
              address
                ? collectorHref(address.toLowerCase(), "airdrop")
                : "/collection?edition=airdrop"
            }
            className="rounded-full bg-ink px-4 py-2 text-white transition hover:bg-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape"
          >
            {address ? "My Base Yunipals" : "Browse Base Yunipals"}
          </Link>
          <Link
            to="/arena/anime/studio"
            className="rounded text-grape underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape"
          >
            View application queue
          </Link>
        </div>
        {!address && (
          <p className="mt-3 text-sm text-muted">
            Connect the owning wallet to apply for your monster.
          </p>
        )}
      </div>
    </aside>
  );
}
