import { lazy } from "react";

import type { ProposalDefinition } from "../types";
import cover from "./art/unidragon-blue.webp";
import avatar from "./avatar.webp";

export const proposal: ProposalDefinition = {
  title: "A better collection card",
  summary:
    "A spec sheet card for the collection: traits as labelled facts, the chain as a mark on the artwork, and a token id you can copy.",
  author: {
    name: "Exochick Arno",
    avatar
  },
  publishedAt: "2026-11-11",
  cover,
  Landing: lazy(() =>
    import("./Landing").then((module) => ({ default: module.Landing }))
  )
};
