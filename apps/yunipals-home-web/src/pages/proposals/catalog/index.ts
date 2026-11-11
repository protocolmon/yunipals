import type { Proposal, ProposalDefinition } from "./types";

// Every folder beside this file is one proposal. Folders are discovered at
// build time, so adding a proposal never means editing a file outside its
// own folder. See README.md.
const modules = import.meta.glob<{ proposal: ProposalDefinition }>(
  "./*/index.ts",
  { eager: true }
);

/** Every published community proposal, newest first. */
export const proposals: readonly Proposal[] = Object.entries(modules)
  .map(([path, module]) => ({
    ...module.proposal,
    slug: path.split("/")[1]
  }))
  .sort(
    (a, b) =>
      b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug)
  );

export function findProposal(slug: string | undefined) {
  return proposals.find((proposal) => proposal.slug === slug);
}

export type { Proposal, ProposalAuthor, ProposalDefinition } from "./types";
