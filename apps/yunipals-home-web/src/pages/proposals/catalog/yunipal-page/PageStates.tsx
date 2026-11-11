import type { ReactNode } from "react";
import { SearchX } from "lucide-react";

const SHELL =
  "bg-[linear-gradient(180deg,#c7c9f9_0%,#e9eafc_30%,#ffffff_58%)] text-ink";

/** The page while the Yunipal is loading: the same layout, as placeholders. */
export function PageLoading() {
  const bar = "animate-pulse rounded-full bg-white/80";
  return (
    <article
      role="status"
      aria-label="Loading Yunipal"
      className={`${SHELL} grid gap-5 p-4 pb-7 [@container_(min-width:768px)]:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] [@container_(min-width:768px)]:items-start [@container_(min-width:768px)]:gap-9 [@container_(min-width:768px)]:p-10`}
    >
      <div className="aspect-square animate-pulse rounded-[18px] border-[5px] border-white bg-white/60" />
      <div aria-hidden="true">
        <div className={`${bar} mt-1 h-3 w-24`} />
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className={`${bar} h-10 w-3/5`} />
          <div className={`${bar} h-5 w-20`} />
        </div>
        <div className={`${bar} mt-3 h-3 w-28`} />
        <div className="mt-6 space-y-2.5">
          <div className={`${bar} h-3.5`} />
          <div className={`${bar} h-3.5`} />
          <div className={`${bar} h-3.5 w-2/3`} />
        </div>
        <div className="mt-9 h-5 w-20 animate-pulse rounded-full bg-line" />
        <div className="mt-4 grid grid-cols-2 gap-x-[18px] gap-y-4">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="space-y-1.5">
              <div className="h-2.5 w-14 animate-pulse rounded-full bg-line" />
              <div className="h-3.5 w-24 animate-pulse rounded-full bg-line/70" />
            </div>
          ))}
        </div>
        <div className="mt-9 h-5 w-44 animate-pulse rounded-full bg-line" />
        <div className="mt-4 space-y-4">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="h-9 animate-pulse rounded-xl bg-line/60"
            />
          ))}
        </div>
      </div>
    </article>
  );
}

/** A full-page message: the Yunipal is missing or the address is wrong. */
export function PageMessage({
  title,
  body,
  actions
}: {
  title: string;
  body: string;
  actions: ReactNode;
}) {
  return (
    <article
      className={`${SHELL} grid min-h-[420px] place-items-center px-6 py-14 text-center`}
    >
      <div className="max-w-sm">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border-[5px] border-white bg-lavender/60 text-grape">
          <SearchX aria-hidden="true" size={22} />
        </span>
        <h3 className="mt-5 font-display text-[28px] leading-tight">{title}</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">{body}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {actions}
        </div>
      </div>
    </article>
  );
}
