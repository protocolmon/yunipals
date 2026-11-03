import { mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import type { PoolClient } from "pg";
import { pool, apiPool } from "../lib/offchain/db.js";
import { refreshNativeBaseMetadataOnClient } from "../lib/metadata/native-base.js";
import { baseMetadataPointRpc } from "../lib/metadata/unified-runtime.js";
import { publishPreparedGeneration } from "../lib/metadata/coordinated-publication.js";

const { values } = parseArgs({
  options: {
    generation: { type: "string" },
    predecessor: { type: "string" },
    journal: { type: "string" }
  }
});
let client: PoolClient | undefined;
try {
  if (
    !values.generation ||
    !values.predecessor ||
    !values.journal ||
    !isAbsolute(values.journal)
  )
    throw new Error("projection_publication_arguments_required");
  // A fresh journal prevents accidental replay after an ambiguous completion.
  await mkdir(values.journal, { mode: 0o700 });
  const directory = await open(dirname(values.journal), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  client = await pool.connect();
  const connected = client;
  const rpc = baseMetadataPointRpc();
  const result = await publishPreparedGeneration(client, {
    generationId: values.generation,
    predecessor: values.predecessor,
    refreshApproval: () => refreshNativeBaseMetadataOnClient(connected, rpc),
    record: async (phase, receipt) => {
      const file = await open(
        join(values.journal!, `${phase}.json`),
        "wx",
        0o600
      );
      try {
        await file.writeFile(
          JSON.stringify({ phase, at: new Date().toISOString(), ...receipt }) +
            "\n"
        );
        await file.sync();
      } finally {
        await file.close();
      }
      const directory = await open(values.journal!, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  });
  console.log(
    JSON.stringify({ event: "native_generation_published", ...result })
  );
} catch (error) {
  const code =
    error instanceof Error && /^projection_[a-z_]+$/.test(error.message)
      ? error.message
      : "projection_publication_refused";
  console.error(
    JSON.stringify({
      event: "native_generation_publication_stopped",
      code,
      inspectPointerBeforeRetry: true
    })
  );
  process.exitCode = 1;
} finally {
  client?.release();
  await Promise.all([pool.end(), apiPool.end()]);
}
