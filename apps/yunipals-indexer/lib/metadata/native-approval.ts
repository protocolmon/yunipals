/** Delay between the end of one native approval run and the start of the next. */
export const NATIVE_APPROVAL_INTERVAL_MS = 2_000;

type Timer = ReturnType<typeof setTimeout>;

export type NativeApproval = {
  /** Stops scheduling further runs; a run in progress finishes. */
  requestStop(): void;
  /** Stops scheduling and waits for a run in progress to finish. */
  stop(): Promise<void>;
};

export type NativeApprovalOptions = {
  onError?: (error: unknown) => void | Promise<void>;
  setTimer?: (callback: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};

/**
 * Runs native Base metadata approval as one background task beside the metadata
 * worker's main loop. Approval waits on point RPC calls and freshness checks, so
 * running it inline delayed publication discovery, the URI audit and publication.
 * Runs never overlap: the next one starts after the previous one settles.
 */
export function startNativeApproval(
  task: () => Promise<void>,
  {
    onError = () => {},
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (timer) => clearTimeout(timer)
  }: NativeApprovalOptions = {}
): NativeApproval {
  let stopping = false;
  let timer: Timer | undefined;
  let release: (() => void) | undefined;
  const pause = () =>
    new Promise<void>((resolve) => {
      const finish = () => {
        timer = undefined;
        release = undefined;
        resolve();
      };
      release = finish;
      timer = setTimer(finish, NATIVE_APPROVAL_INTERVAL_MS);
    });
  const done = (async () => {
    while (!stopping) {
      try {
        await task();
      } catch (error) {
        await onError(error);
      }
      if (!stopping) await pause();
    }
  })();
  // Keep a failure for stop() without an unhandled rejection in the meantime.
  void done.catch(() => {});
  const requestStop = () => {
    stopping = true;
    if (timer !== undefined) {
      clearTimer(timer);
      release?.();
    }
  };
  return Object.freeze({
    requestStop,
    async stop() {
      requestStop();
      await done;
    }
  });
}
