import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  portalColorNames,
  portalTypeNames
} from "@protopals/yunipals-market-core/portals";
import { fetchPortalCardCounts } from "@/lib/portalCardCounts";
import { cn } from "@/lib/utils";
import {
  portalCardImage,
  portalRange,
  type ActivePortalStatus
} from "@/lib/portals";

export function PortalSchedule({
  status,
  owner,
  now
}: {
  status: ActivePortalStatus;
  owner?: string;
  now: number;
}) {
  const upcoming = (status.rotation.upcoming ?? []).filter(
    (item) => Number(item.startsAt) > now
  );
  const portalIds = [
    ...new Set(
      upcoming
        .filter((item) => !item.portal.retired)
        .map((item) => item.portal.id)
    )
  ].sort();
  const { deployment } = status;
  const counts = useQuery({
    queryKey: [
      "portals",
      "matching-cards",
      owner?.toLowerCase(),
      deployment.chainId,
      deployment.collection.toLowerCase(),
      deployment.grading.toLowerCase(),
      deployment.cards.toLowerCase(),
      portalIds
    ],
    queryFn: ({ signal }) =>
      fetchPortalCardCounts(owner!, deployment, portalIds, signal),
    enabled:
      Boolean(owner) &&
      deployment.chainId === 8453 &&
      status.rotation.queueCapacity === 11 &&
      portalIds.length > 0,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false
  });
  if (status.rotation.queueCapacity !== 11) return null;
  return (
    <section
      aria-labelledby="portal-schedule-title"
      className="mt-8 rounded-card border border-line bg-white p-6 shadow-card sm:p-8"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="portal-schedule-title" className="font-display text-2xl">
          {status.revealedAdmissions
            ? "Revealed portals · submit now"
            : "Upcoming portals"}
        </h2>
        <p className="text-sm font-semibold">
          {upcoming.length} of 11 future windows revealed
        </p>
      </div>
      <p className="mt-3 text-sm text-muted">
        {status.revealedAdmissions
          ? "All revealed portals accept matching cards now, until their listed closing time. Choose a portal to see its requirements and submit your monster. Times are shown in your local time zone."
          : "Each portal opens an 11-minute window to submit eligible cards for grading. Windows open automatically; times are shown in your local time zone. Refill the schedule above to reveal more windows."}
      </p>
      {owner && portalIds.length > 0 ? (
        <p className="mt-2 text-xs text-muted">
          Matches use your currently indexed cards and exclude spells still
          processing. Eligibility is checked again when you submit.
          {counts.isError && (
            <button
              type="button"
              disabled={counts.isFetching}
              onClick={() => void counts.refetch()}
              className="ml-2 rounded font-bold underline focus-visible:outline-grape disabled:opacity-50"
            >
              {counts.isFetching ? "Checking…" : "Retry card counts"}
            </button>
          )}
        </p>
      ) : !owner && upcoming.length > 0 ? (
        <p className="mt-2 text-xs text-muted">
          Connect your wallet to see how many of your cards match each portal.
        </p>
      ) : null}
      {upcoming.length === 0 ? (
        <div className="mt-5 flex items-center gap-5 rounded-2xl bg-lavender/40 p-5">
          <img
            src="/images/portals/rainbow-portal-card-v3.webp"
            width={1024}
            height={1536}
            className="w-20 rounded-xl"
            alt="Rainbow Portal artwork preview"
            loading="lazy"
          />
          <p className="text-sm text-muted">
            {status.rotation.requestId !== "0"
              ? "The next windows are being revealed. Check back when the request completes."
              : "The next chapter is still a surprise. Request a refill to reveal the upcoming portals."}
          </p>
        </div>
      ) : (
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {upcoming.map((item) => {
            const { portal } = item;
            const match = counts.data?.items.find(
              (item) => item.portalId === portal.id
            );
            const count =
              !counts.isError && match && !match.retired
                ? match.count
                : undefined;
            const starts = new Date(Number(item.startsAt) * 1000);
            const ends = new Date(Number(item.endsAt) * 1000);
            return (
              <li
                key={item.id}
                className="flex gap-4 rounded-2xl bg-lavender/30 p-4"
              >
                <img
                  src={portalCardImage(portal)}
                  width={1024}
                  height={1536}
                  className="h-32 w-20 shrink-0 rounded-xl object-contain"
                  alt={`${portal.name} #${portal.id}`}
                  loading="lazy"
                />
                <div className="min-w-0 text-sm">
                  <h3 className="font-bold">
                    {portal.name} #{portal.id}
                  </h3>
                  <p className="mt-1">
                    {status.revealedAdmissions ? (
                      "Closes "
                    ) : (
                      <>
                        <time dateTime={starts.toISOString()}>
                          {starts.toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </time>
                        –
                      </>
                    )}
                    <time dateTime={ends.toISOString()}>
                      {ends.toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </time>
                  </p>
                  {owner && !portal.retired && (
                    <p
                      className={cn(
                        "mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-bold",
                        count !== undefined && count > 0
                          ? "bg-mint text-ink"
                          : "bg-white/75 text-muted"
                      )}
                      aria-live="polite"
                    >
                      {counts.isError ||
                      match?.retired ||
                      deployment.chainId !== 8453
                        ? "Count unavailable"
                        : count === undefined
                          ? "Checking cards…"
                          : count === 0
                            ? "No matching cards"
                            : `${count.toLocaleString()} matching ${count === 1 ? "card" : "cards"}`}
                    </p>
                  )}
                  {status.revealedAdmissions &&
                    owner &&
                    deployment.chainId === 8453 &&
                    !portal.retired &&
                    count !== undefined &&
                    count > 0 && (
                      <Link
                        to={`/grading?round=${item.id}#portal-cast`}
                        aria-current={
                          status.round.id === item.id ? "true" : undefined
                        }
                        className="mt-3 inline-flex rounded-full bg-grape px-4 py-2 font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape"
                      >
                        {status.round.id === item.id
                          ? "Selected portal"
                          : "Submit a monster"}
                      </Link>
                    )}
                  {portal.retired ? (
                    <p className="mt-2 font-semibold">
                      Redeemed · this window stays closed
                    </p>
                  ) : (
                    <details className="mt-2">
                      <summary className="cursor-pointer font-semibold focus-visible:outline focus-visible:outline-2">
                        Entry requirements
                      </summary>
                      <ul className="mt-2 space-y-1 text-muted">
                        <li>
                          {portalColorNames[portal.gates.colorGate]} ·{" "}
                          {portalTypeNames[portal.gates.typeGate]}
                        </li>
                        <li>
                          {portal.gates.originalOnly
                            ? "Original cards only"
                            : `Sequence ${portalRange(portal.gates.sequenceStart, portal.gates.sequenceLength)}`}
                        </li>
                        <li>
                          {portal.gates.glitterGate
                            ? "Glitter required"
                            : "Any finish"}{" "}
                          ·{" "}
                          {portal.gates.diamondGate
                            ? "Diamond horn required"
                            : "Any horn"}
                        </li>
                      </ul>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
