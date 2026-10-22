// Test-only virtual module adapter. The handler and schema stay unmodified.
import * as schema from "../../ponder.schema.ts";

export default schema;
export const callbacks = new Map();
export const ponder = {
  on(name, callback) {
    if (callbacks.has(name)) throw new Error("Duplicate fixture callback.");
    callbacks.set(name, callback);
  }
};
