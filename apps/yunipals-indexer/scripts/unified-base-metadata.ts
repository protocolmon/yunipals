import {
  adoptBaseMetadataConsumer,
  consumeBaseMetadataPage
} from "../lib/metadata/unified-base.js";
import {
  unifiedBaseRuntime,
  baseMetadataPointRpc
} from "../lib/metadata/unified-runtime.js";
import {
  adoptNativeBaseMetadata,
  refreshNativeBaseMetadata,
  backfillNativeBaseMetadataProvenance
} from "../lib/metadata/native-base.js";
import { argumentsOf, postgresFrom, safeFailure } from "./metadata/support.js";
import { assertRecoveryRuntimeEnvironment } from "./metadata/recovery.js";

const args = argumentsOf({ command: { type: "string", default: "consume" } });
if (
  ![
    "adopt",
    "consume",
    "native-adopt",
    "native-refresh",
    "native-provenance"
  ].includes(String(args.command))
)
  throw new Error(
    "Use --command adopt, consume, native-adopt, native-refresh or native-provenance."
  );
const { pool, env } = await postgresFrom(String(args["env-file"]));
let runtime: ReturnType<typeof unifiedBaseRuntime> | undefined;
try {
  // Adoption is a reviewed, explicit release migration; it never creates an
  // active-release pointer or selects an unregistered physical schema.
  if (args.command === "adopt" && !env.UNIFIED_INDEXER_RELEASE_ID)
    throw new Error("Adoption requires an explicit registered release ID.");
  if (String(args.command).startsWith("native-")) {
    assertRecoveryRuntimeEnvironment(env);
    if (!env.OWNERSHIP_RELEASE_ID)
      throw new Error(
        "Native migration requires an explicit ownership release ID."
      );
    const rpc = baseMetadataPointRpc(env);
    if (args.command === "native-provenance")
      await refreshNativeBaseMetadata(pool, rpc);
    const result =
      args.command === "native-adopt"
        ? await adoptNativeBaseMetadata(pool, rpc)
        : args.command === "native-refresh"
          ? await refreshNativeBaseMetadata(pool, rpc)
          : await backfillNativeBaseMetadataProvenance(pool);
    console.log(
      JSON.stringify({ event: `base_metadata_${args.command}`, ...result })
    );
  } else {
    runtime = unifiedBaseRuntime(env);
    const reader = await runtime.reader();
    const result =
      args.command === "adopt"
        ? await adoptBaseMetadataConsumer(pool, reader, runtime.rpc)
        : await consumeBaseMetadataPage(pool, reader, runtime.rpc);
    console.log(
      JSON.stringify({ event: `base_metadata_${args.command}`, ...result })
    );
  }
} catch (error) {
  console.error(safeFailure(error));
  process.exitCode = 1;
} finally {
  await runtime?.close();
  await pool.end();
}
