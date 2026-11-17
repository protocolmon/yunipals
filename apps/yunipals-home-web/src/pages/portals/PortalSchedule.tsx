import {
  portalColorNames,
  portalTypeNames
} from "@protopals/yunipals-market-core/portals";
import {
  portalImage,
  portalRange,
  type ActivePortalStatus
} from "@/lib/portals";

export function PortalSchedule({
  status,
  now
}: {
  status: ActivePortalStatus;
  now: number;
}) {
  if (status.rotation.queueCapacity !== 11) return null;
  const upcoming = (status.rotation.upcoming ?? []).filter(
    (item) => Number(item.startsAt) > now
  );
  return (
    <section
      aria-labelledby="portal-schedule-title"
      className="mt-8 rounded-card border border-line bg-white p-6 shadow-card sm:p-8"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="portal-schedule-title" className="font-display text-2xl">
          Upcoming portals
        </h2>
        <p className="text-sm font-semibold">
          {upcoming.length} of 11 future windows revealed
        </p>
      </div>
      <p className="mt-3 text-sm text-muted">
        Each window lasts 11 minutes and opens automatically. Times are shown in
        your local time zone. Refill the schedule above to reveal more windows.
      </p>
      {upcoming.length === 0 ? (
        <div className="mt-5 flex items-center gap-5 rounded-2xl bg-lavender/40 p-5">
          <img
            src="/images/portals/rainbow-portal-card.webp"
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
            const starts = new Date(Number(item.startsAt) * 1000);
            const ends = new Date(Number(item.endsAt) * 1000);
            return (
              <li
                key={item.id}
                className="flex gap-4 rounded-2xl bg-lavender/30 p-4"
              >
                <img
                  src={portalImage(portal.imageURI)}
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
                    <time dateTime={starts.toISOString()}>
                      {starts.toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </time>
                    –
                    <time dateTime={ends.toISOString()}>
                      {ends.toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </time>
                  </p>
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
