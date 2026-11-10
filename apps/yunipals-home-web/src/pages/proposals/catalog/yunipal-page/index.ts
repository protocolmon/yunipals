import { lazy } from "react";

import type { ProposalDefinition } from "../types";
import cover from "./art/unidragon.webp";
import avatar from "./avatar.webp";

export const proposal: ProposalDefinition = {
  title: "A Yunipal page that tells its story",
  summary: "A calmer detail page in three tabs: story, market and journey.",
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
