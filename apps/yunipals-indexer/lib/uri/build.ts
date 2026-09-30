import { CONSTRUCTOR_BASE_URI } from "../constants.js";

export function buildTokenUri(tokenId: string) {
  if (!/^\d+$/.test(tokenId)) throw new Error("Token ID must be a decimal integer");
  return `${CONSTRUCTOR_BASE_URI}${tokenId}`;
}
