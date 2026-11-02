import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { validateSharedIndexerDeployment } from "../lib/unified/shared-deployment.js";
import {
  encodeSharedConsumerSettings,
  sharedIndexerConsumers,
  sharedConsumerSettings,
  type SharedIndexerConsumer
} from "../lib/unified/shared-consumers.js";

const { values } = parseArgs({
  options: {
    deployment: { type: "string" },
    consumer: { type: "string" },
    profile: { type: "string" },
    output: { type: "string" }
  }
});
try {
  if (
    !values.deployment?.startsWith("/") ||
    !values.output?.startsWith("/") ||
    !sharedIndexerConsumers.some((consumer) => consumer === values.consumer)
  )
    throw new Error(
      "Use absolute deployment/output files and an explicit consumer."
    );
  const deployment = validateSharedIndexerDeployment(
    JSON.parse(await readFile(values.deployment, "utf8"))
  );
  const settings = sharedConsumerSettings(
    deployment,
    values.consumer as SharedIndexerConsumer,
    { deployment: values.deployment, profile: values.profile }
  );
  await writeFile(values.output, encodeSharedConsumerSettings(settings), {
    flag: "wx",
    mode: 0o644
  });
  console.log(
    JSON.stringify({
      event: "shared_consumer_settings_prepared",
      consumer: values.consumer,
      releaseId: deployment.releaseId,
      settings: Object.keys(settings).sort(),
      activated: false,
      writesToDatabase: 0
    })
  );
} catch {
  console.error(
    "Shared consumer configuration refused; no service was changed."
  );
  process.exitCode = 1;
}
