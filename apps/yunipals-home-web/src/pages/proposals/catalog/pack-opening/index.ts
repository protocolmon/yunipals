import { lazy } from "react";

import type { ProposalDefinition } from "../types";
import avatar from "./avatar.webp";

export const proposal: ProposalDefinition = {
  title: "A new way to open a pack",
  summary:
    "Eleven playable concepts for the pack opening, from foil you scratch off by hand to a card that drops out of hyperspace. Try each one and see which feels right.",
  author: {
    name: "Exochick Arno",
    avatar
  },
  publishedAt: "2026-11-11",
  cover: "/images/boosters/yunipals-pack-v1.png",
  optionCount: 11,
  Landing: lazy(() =>
    import("./Landing").then((module) => ({ default: module.Landing }))
  )
};
