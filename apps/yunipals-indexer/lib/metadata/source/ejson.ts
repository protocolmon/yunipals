/** Decode the BSON values needed for rendering, without a runtime Mongo driver. */
export function decodeSource(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeSource);
  if (value === null || typeof value !== "object") return value;
  const object = value as Record<string, unknown>, keys = Object.keys(object);
  if (keys.length === 1) {
    if (typeof object.$oid === "string") return object.$oid;
    if (typeof object.$numberInt === "string") {
      const number = Number(object.$numberInt);
      if (!Number.isSafeInteger(number)) throw new Error("Invalid BSON integer");
      return number;
    }
    if (typeof object.$numberLong === "string") {
      const number = Number(object.$numberLong);
      return Number.isSafeInteger(number) ? number : object.$numberLong;
    }
    if (typeof object.$numberDouble === "string") {
      const number = Number(object.$numberDouble);
      if (!Number.isFinite(number)) throw new Error("Non-finite BSON number cannot be rendered");
      return number;
    }
    if (typeof object.$numberDecimal === "string") return object.$numberDecimal;
    if (object.$date !== undefined) {
      const decoded = decodeSource(object.$date);
      if (typeof decoded !== "string" && typeof decoded !== "number") throw new Error("Invalid BSON date");
      const date = new Date(decoded);
      if (Number.isNaN(date.getTime())) throw new Error("Invalid BSON date");
      return date.toISOString();
    }
  }
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, decodeSource(item)]));
}
