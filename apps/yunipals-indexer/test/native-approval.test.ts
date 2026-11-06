import { describe, expect, it } from "vitest";
import {
  NATIVE_APPROVAL_INTERVAL_MS,
  startNativeApproval
} from "../lib/metadata/native-approval.js";

type Timer = ReturnType<typeof setTimeout>;

/** Timers that fire only when the test says so. */
function manualTimers() {
  const pending = new Map<number, () => void>();
  const delays: number[] = [];
  let next = 1;
  return {
    delays,
    pending,
    setTimer: (callback: () => void, ms: number) => {
      delays.push(ms);
      const id = next++;
      pending.set(id, callback);
      return id as unknown as Timer;
    },
    clearTimer: (timer: Timer) => {
      pending.delete(timer as unknown as number);
    },
    fire() {
      const [id, callback] = [...pending][0] ?? [];
      if (!callback) throw new Error("no timer pending");
      pending.delete(id!);
      callback();
    }
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("native approval scheduling", () => {
  it("runs one task at a time and waits between runs", async () => {
    const timers = manualTimers();
    let running = 0;
    let maxRunning = 0;
    let runs = 0;
    const approval = startNativeApproval(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      runs++;
      await settle();
      running--;
    }, timers);
    await settle();
    await settle();
    expect(runs).toBe(1);
    expect(timers.delays).toEqual([NATIVE_APPROVAL_INTERVAL_MS]);
    timers.fire();
    await settle();
    await settle();
    expect(runs).toBe(2);
    expect(maxRunning).toBe(1);
    await approval.stop();
    expect(timers.pending.size).toBe(0);
  });

  it("reports failures and keeps running", async () => {
    const timers = manualTimers();
    const errors: unknown[] = [];
    let runs = 0;
    const approval = startNativeApproval(
      async () => {
        runs++;
        throw new Error(`run ${runs}`);
      },
      { ...timers, onError: (error) => void errors.push(error) }
    );
    await settle();
    timers.fire();
    await settle();
    expect(runs).toBe(2);
    expect(errors.map((error) => (error as Error).message)).toEqual([
      "run 1",
      "run 2"
    ]);
    await approval.stop();
  });

  it("waits for a run in progress before stopping", async () => {
    const timers = manualTimers();
    let finishRun!: () => void;
    let finished = false;
    const approval = startNativeApproval(async () => {
      await new Promise<void>((resolve) => (finishRun = resolve));
      finished = true;
    }, timers);
    await settle();
    let stopped = false;
    const stopping = approval.stop().then(() => (stopped = true));
    await settle();
    expect(stopped).toBe(false);
    finishRun();
    await stopping;
    expect(finished).toBe(true);
    expect(timers.delays).toEqual([]);
  });

  it("does not start another run after a stop request", async () => {
    const timers = manualTimers();
    let runs = 0;
    const approval = startNativeApproval(async () => {
      runs++;
    }, timers);
    await settle();
    approval.requestStop();
    expect(timers.pending.size).toBe(0);
    await approval.stop();
    expect(runs).toBe(1);
  });
});
