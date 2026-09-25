import { createPool } from "@/db/pool";
import { readEnvironment, readOpenSeaStreamEnvironment } from "@/environment";
import { assertOpenSeaStreamReady } from "@/opensea/stream";
import { runOpenSeaStreamWorker } from "@/opensea/streamTransport";

async function main() {
  const environment = readEnvironment();
  const config = readOpenSeaStreamEnvironment();
  const pool = createPool(environment);
  pool.on("error", () => console.error("Stream database connection failed."));
  const stop = new AbortController();
  const onStop = () => stop.abort();
  process.once("SIGTERM", onStop);
  process.once("SIGINT", onStop);
  const timeout = config.maxSeconds
    ? setTimeout(() => stop.abort(), config.maxSeconds * 1000)
    : undefined;
  try {
    await assertOpenSeaStreamReady(pool, environment.deployment);
    const report = await runOpenSeaStreamWorker({
      pool,
      apiKey: config.apiKey,
      signal: stop.signal
    });
    console.log(
      JSON.stringify({
        service: "yunipals-opensea-stream",
        status: "stopped",
        ...report,
        providerWritesEnabled: false,
        tradingEnabled: false
      })
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    process.removeListener("SIGTERM", onStop);
    process.removeListener("SIGINT", onStop);
    await pool.end();
  }
}

try {
  await main();
} catch {
  console.error(
    "OpenSea stream configuration or execution failed; credentials and raw errors suppressed."
  );
  process.exitCode = 1;
}
