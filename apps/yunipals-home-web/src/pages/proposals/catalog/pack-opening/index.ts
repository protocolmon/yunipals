import { proposalPreviews } from "@/lib/social/proposals";
import { lazy } from "react";

import type { ProposalDefinition } from "../types";
import avatar from "./avatar.webp";

export const proposal: ProposalDefinition = {
  title: proposalPreviews["pack-opening"].title,
  summary: proposalPreviews["pack-opening"].description,
  author: {
    name: "Exochick Arno",
    avatar
  },
  publishedAt: "2026-11-11",
  status: "accepted",
  cover: "/images/boosters/yunipals-pack-v1.png",
  optionCount: 11,
  Landing: lazy(() =>
    import("./Landing").then((module) => ({ default: module.Landing }))
  )
};
