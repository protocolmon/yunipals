import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";

import { usePageMetadata } from "@/hooks/usePageMetadata";
import { findProposal, type Proposal } from "./catalog";
import { ProposalAuthor } from "./ProposalAuthor";

export function ProposalPage() {
  const proposal = findProposal(useParams().slug);
  if (!proposal) return <Navigate to="/proposals" replace />;
  return <ProposalView proposal={proposal} />;
}

function ProposalView({ proposal }: { proposal: Proposal }) {
  usePageMetadata(`${proposal.title} | Yunipals`, proposal.summary);
  const { Landing } = proposal;

  return (
    <main>
      <article>
        <header className="border-b border-line bg-gradient-to-br from-lavender/30 via-white to-mint/20 px-5 py-10 sm:py-16">
          <div className="mx-auto max-w-6xl">
            <Link
              to="/proposals"
              className="inline-flex items-center gap-2 rounded-full py-2 text-sm font-bold text-muted hover:text-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              All proposals
            </Link>
            <p className="mt-8 text-sm font-bold uppercase tracking-widest text-grape">
              Community proposal · Concept
            </p>
            <h1 className="mt-4 max-w-3xl font-display text-4xl leading-tight text-ink sm:text-5xl lg:text-6xl">
              {proposal.title}
            </h1>
            <p className="mt-6 max-w-2xl text-xl leading-relaxed text-muted">
              {proposal.summary}
            </p>
            <div className="mt-8">
              <ProposalAuthor
                author={proposal.author}
                publishedAt={proposal.publishedAt}
                size="lg"
              />
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-6xl px-5 py-12">
          <Suspense
            fallback={
              <div
                role="status"
                className="h-64 animate-pulse rounded-card bg-lavender/20"
              >
                <span className="sr-only">Loading proposal…</span>
              </div>
            }
          >
            <Landing />
          </Suspense>
        </div>
      </article>
    </main>
  );
}
