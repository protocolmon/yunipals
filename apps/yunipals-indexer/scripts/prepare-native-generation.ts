// Build and validate only. Global reader pointers, wallet statistics and derived
// stamps remain under the separate coordinated publication owner.
import { pool } from "../lib/offchain/db.js";
import { refreshProjectionGeneration } from "../lib/metadata/projection-refresh.js";
import { nativeProjectionSnapshotEnabled } from "../lib/metadata/projection-snapshot.js";

if (process.argv.length !== 2 || !nativeProjectionSnapshotEnabled())
  throw new Error("Native generation preparation takes no arguments");
try {
  const result = await refreshProjectionGeneration({ publish: false });
  if (!("prepared" in result) || !result.prepared)
    throw new Error(
      "Native generation preparation did not return its candidate"
    );
  console.log(
    JSON.stringify({
      event: "native_generation_prepared",
      built: true,
      validated: true,
      published: false,
      ...result
    })
  );
} finally {
  await pool.end();
}
