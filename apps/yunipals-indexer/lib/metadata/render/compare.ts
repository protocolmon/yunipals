import { canonicalJson } from "../source/canonical.js";

/** Only these explicit differences are ignored. Parent/ID array order matters. */
export function comparisonDocument(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparisonDocument);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === "attributes" && Array.isArray(item)) {
      return [key, item.filter(trait => trait?.trait_type !== "Last metadata update")
        .map(comparisonDocument).sort((left,right) => canonicalJson(left).localeCompare(canonicalJson(right)))];
    }
    return [key, comparisonDocument(item)];
  }));
}
