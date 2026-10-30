import { setTimeout } from "node:timers/promises";
import { arenaSigner } from "./config";
import { arenaRuntime } from "./runtime";
import { NativeArenaControl } from "./nativeControl";
import { NativeArenaSettlement } from "./nativeSettlement";
import { NativeArenaExecution } from "./nativeExecution";
import { arenaNativeConfiguration } from "./nativeSource";

async function run() {
  if (arenaNativeConfiguration().mode !== "unified")
    throw new Error("Explicit native source selection is required.");
  const requestedRole = process.env.ARENA_EXECUTION_ROLE;
  const role = requestedRole === "operator" ? "lobby" : requestedRole,
    key = process.env.ARENA_EXECUTION_KEY_FILE,
    cap = process.env.ARENA_MAX_CONTROL_EXECUTION_FEE_WEI;
  if (
    (role !== "lobby" && role !== "referee") ||
    !key ||
    !cap ||
    !/^[1-9][0-9]*$/.test(cap)
  )
    throw new Error(
      "Explicit native execution role, signer and fee cap are required."
    );
  if (role === "lobby" && process.env.ARENA_NEW_LOBBIES_ENABLED !== "true")
    throw new Error("Native automatic lobby creation is not enabled.");
  const settlementCap = process.env.ARENA_MAX_SETTLEMENT_EXECUTION_FEE_WEI;
  if (
    role === "referee" &&
    (!settlementCap || !/^[1-9][0-9]*$/.test(settlementCap))
  )
    throw new Error("A separate settlement execution fee cap is required.");
  const runtime = await arenaRuntime({ native: true, execution: true });
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    if (!runtime.service.nativeSource)
      throw new Error("Native execution requires explicit unified mode.");
    const account = arenaSigner(key),
      client = runtime.clients.get(8453)!;
    const control = new NativeArenaControl(
      runtime.service,
      runtime.compiler,
      client,
      account,
      BigInt(cap),
      runtime.capacity,
      process.env.ARENA_MEDIA_ROOT
    );
    const settlement = new NativeArenaSettlement(
      runtime.service,
      client,
      account,
      BigInt(settlementCap ?? cap)
    );
    const work = new NativeArenaExecution(
      runtime.service,
      account.address,
      role,
      control,
      settlement
    );
    while (!stopped) {
      try {
        const result = await work.tick();
        if (result)
          console.log(
            JSON.stringify({
              event: "arena_native_execution",
              actionId: result.action_id,
              purpose: result.purpose,
              state: result.state,
              transactionHash: result.tx_hash
            })
          );
      } catch {
        console.error(
          "Native Arena execution needs reconciliation; saved signed transactions and receipt history retained."
        );
      }
      if (!stopped) await setTimeout(2000);
    }
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await runtime.close();
  }
}
try {
  await run();
} catch {
  console.error(
    "Native Arena execution could not start; check source selection, role, signer and operational migrations."
  );
  process.exitCode = 1;
}
