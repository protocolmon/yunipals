import type { ComponentType, LazyExoticComponent } from "react";

export type ProposalAuthor = {
  /** Display name shown on the catalog card and the proposal page. */
  name: string;
  /** Square profile picture: an image imported from the proposal's folder. */
  avatar: string;
  /** Optional public profile link (X, Farcaster, a collector page…). */
  link?: string;
};

/** What a proposal folder's `index.ts` exports as `proposal`. */
export type ProposalDefinition = {
  title: string;
  /** One or two sentences for the catalog card and the page introduction. */
  summary: string;
  author: ProposalAuthor;
  /** ISO date (YYYY-MM-DD) the proposal was added. Newest is listed first. */
  publishedAt: string;
  /** Optional card image. */
  cover?: string;
  /** How many options the landing page presents, shown on the card. */
  optionCount?: number;
  /** The landing page body, loaded only when the proposal is opened. */
  Landing: LazyExoticComponent<ComponentType>;
};

/** A discovered proposal. The slug is its folder name: `/proposals/<slug>`. */
export type Proposal = ProposalDefinition & { slug: string };
