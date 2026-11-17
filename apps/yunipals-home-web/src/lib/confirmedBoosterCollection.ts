import { boosterQueryKey } from "@/lib/boosters";

/** Recorded only after the reveal's request cards have been verified. */
export type ConfirmedBoosterCollection = {
  indexedBlock: string;
  tokenIds: string[];
};
export const confirmedBoosterCollectionKey = (owner: string) => [
  ...boosterQueryKey,
  "confirmed-collection",
  owner.toLowerCase()
];
