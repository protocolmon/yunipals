import { loadEnvFile } from "node:process";
import { createPortalRuntime } from "../lib/portals/runtime.js";
import { SharedPortalLedger } from "../lib/portals/shared-ledger.js";
import { comparePortalSources } from "../lib/unified/portal-parity.js";

if (process.env.PORTALS_ENV_FILE) loadEnvFile(process.env.PORTALS_ENV_FILE);
async function main() {
  const runtime = await createPortalRuntime({
    ...process.env,
    PORTALS_INDEXER_MODE: "unified"
  });
  try {
    if (!(runtime.ledger instanceof SharedPortalLedger))
      throw new Error("Shared reader required.");
    const report = await comparePortalSources(runtime.db, runtime.ledger);
    console.log(JSON.stringify(report, null, 2));
    if (!report.matches) process.exitCode = 1;
  } finally {
    await runtime.close();
  }
}
main().catch(() => {
  console.error(
    "Portal source comparison could not establish a complete canonical boundary."
  );
  process.exitCode = 1;
});
