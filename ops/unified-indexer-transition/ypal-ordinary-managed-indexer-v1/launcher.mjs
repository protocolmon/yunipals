// The original supervisor remains byte-identical in core.mjs. This entry adds
// one public EVM permit file; the separate Solana child is unchanged.
import { writeSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  childDefinitions,
  launchConfiguration as originalConfiguration,
  runManagedIndexer
} from "./core.mjs";

export const ordinaryEnvironment =
  "/opt/yunipals-unified/operations/free-replay-20261020/ypal-alchemy-primary-queue-v1/source.ordinary.public.env";

export function launchConfiguration(environment) {
  const configuration = originalConfiguration(environment);
  if (
    environment.YUNIPALS_INDEXER_PONDER_REPLAY_ENV_FILE !==
      ordinaryEnvironment ||
    new Set([
      ...configuration.evmEnvironment,
      ordinaryEnvironment,
      configuration.solanaEnvironment
    ]).size !== 5
  ) {
    throw Error("exact_fourth_ordinary_EVM_and_separate_Solana_file_required");
  }
  return {
    ...configuration,
    evmEnvironment: [...configuration.evmEnvironment, ordinaryEnvironment]
  };
}

export { childDefinitions, runManagedIndexer };

async function main() {
  if (process.versions.node !== "24.18.1") {
    throw Error("pinned_node24_runtime_required");
  }
  const grace = process.env.YUNIPALS_INDEXER_SHUTDOWN_GRACE_MS ?? "30000";
  if (!/^(0|[1-9][0-9]*)$/.test(grace)) {
    throw Error("bounded_shutdown_grace_required");
  }
  process.exitCode = await runManagedIndexer(launchConfiguration(process.env), {
    graceMilliseconds: Number(grace)
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    writeSync(2, "Managed indexer configuration or startup failed.\n");
    process.exitCode = 1;
  });
}
