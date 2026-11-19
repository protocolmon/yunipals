import { proposalPreviews } from "@/lib/social/proposals";
import { lazy } from "react";

import type { ProposalDefinition } from "../types";
import cover from "./art/unidragon.webp";
import avatar from "./avatar.webp";

export const proposal: ProposalDefinition = {
  title: proposalPreviews["yunipal-page"].title,
  summary: proposalPreviews["yunipal-page"].description,
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
