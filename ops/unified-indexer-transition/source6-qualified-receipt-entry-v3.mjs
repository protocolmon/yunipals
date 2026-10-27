// The accepted finite loop is imported unchanged; only the OS peer-group guard is corrected.
import { pathToFileURL } from "node:url";
import { runReceiptLoop } from "./source6-normal-receipt-loop.mjs";
import { runProbe } from "./support-probe-runner-v6.mjs";

export async function main() {
  let stop = false;
  process.on("SIGTERM", () => { stop = true; });
  process.on("SIGINT", () => { stop = true; });
  const result = await runReceiptLoop({ runProbe,
    profileId: "0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728",
    stopping: () => stop });
  console.log(JSON.stringify({ event: "bounded_receipt_support_complete", ...result }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
