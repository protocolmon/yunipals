import { readOpenSeaProbeEnvironment } from "@/environment";
import { OpenSeaClient } from "@/opensea/client";
import { createOpenSeaRequestBudget } from "@/opensea/requestBudget";
import { OpenSeaSharedPolicyResolver } from "@/opensea/sharedPolicy";
import { probeOpenSeaAccess } from "@/opensea/probe";

async function main() {
  const environment = readOpenSeaProbeEnvironment();
  const coordinator = createOpenSeaRequestBudget();
  try {
    const client = new OpenSeaClient({
      apiKey: environment.apiKey,
      requestBudget: coordinator.budgetFor({
        caller: "probe",
        workload: "incident",
        priority: "foreground"
      })
    });
    const resolver = new OpenSeaSharedPolicyResolver(
      coordinator.pool,
      coordinator.scope,
      client,
      {
        maxDurationSeconds: environment.maxDurationSeconds
      }
    );
    const report = await probeOpenSeaAccess(resolver);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "available") process.exitCode = 1;
  } finally {
    await coordinator.close();
  }
}
try {
  await main();
} catch {
  console.error(
    "OpenSea read-only probe configuration or execution failed; credential and raw errors suppressed."
  );
  process.exitCode = 1;
}
