import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { usePageMetadata } from "@/hooks/usePageMetadata";
import { proposals } from "./catalog";
import { ProposalAuthor } from "./ProposalAuthor";
import { ProposalsArt } from "./ProposalsArt";

export function ProposalsPage() {
  usePageMetadata(
    "Community proposals | Yunipals",
    "Ideas for Yunipals from the team and the community, each presented as a page you can explore."
  );

  return (
    <main>
      <header className="overflow-hidden border-b border-line bg-gradient-to-br from-lavender/30 via-white to-mint/20 px-5 py-10 sm:py-16">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-grape">
              Community proposals
            </p>
            <h1 className="mt-4 max-w-3xl font-display text-4xl leading-tight text-ink sm:text-5xl">
              Ideas for what Yunipals becomes next.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">
              Each proposal is a concept with its own page and a set of options
              to explore. They are ideas for discussion, not commitments.
            </p>
          </div>
          <ProposalsArt className="mx-auto max-w-xs lg:max-w-none" />
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-5 py-12">
        {proposals.length === 0 ? (
          <p className="rounded-card border border-line bg-white p-6 text-muted">
            No proposals have been published yet.
          </p>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {proposals.map((proposal) => (
              <li key={proposal.slug}>
                <Link
                  to={`/proposals/${proposal.slug}`}
                  className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-white shadow-card transition-shadow hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape"
                >
                  <span className="flex h-44 items-center justify-center bg-gradient-to-br from-lavender/60 via-lavender/20 to-sky/40">
                    {proposal.cover && (
                      <img
                        src={proposal.cover}
                        alt=""
                        loading="lazy"
                        className="h-36 w-auto object-contain drop-shadow-xl transition-transform group-hover:scale-105"
                      />
                    )}
                  </span>
                  <span className="flex flex-1 flex-col p-6">
                    <span className="text-xs font-bold uppercase tracking-widest text-grape">
                      Concept
                      {proposal.optionCount
                        ? ` · ${proposal.optionCount} options`
                        : ""}
                    </span>
                    <span className="mt-3 font-display text-2xl leading-tight text-ink">
                      {proposal.title}
                    </span>
                    <span className="mt-3 flex-1 text-sm leading-relaxed text-muted">
                      {proposal.summary}
                    </span>
                    <span className="mt-6 flex items-center justify-between gap-4">
                      <ProposalAuthor
                        author={{ ...proposal.author, link: undefined }}
                        publishedAt={proposal.publishedAt}
                      />
                      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-grape">
                        View
                        <ArrowRight size={16} aria-hidden="true" />
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
