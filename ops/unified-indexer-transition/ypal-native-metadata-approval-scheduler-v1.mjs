// One approval task in the existing worker and pool. Import is inert.
export const INTERVAL_MS = 2_000;

export function startNativeApproval(task, {
  onError = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  if (typeof task !== "function" || typeof onError !== "function" ||
      typeof setTimer !== "function" || typeof clearTimer !== "function") {
    throw new Error("native_approval_task_and_timer_functions_required");
  }
  let stopping = false;
  let timer;
  let release;
  const pause = () => new Promise((resolve) => {
    const finish = () => { timer = undefined; release = undefined; resolve(); };
    release = finish;
    timer = setTimer(finish, INTERVAL_MS);
  });
  const done = (async () => {
    while (!stopping) {
      try { await task(); }
      catch (error) { await onError(error); }
      if (!stopping) await pause();
    }
  })();
  // Preserve a failure for stop()/join without an unhandled rejection while
  // foreground work is still settling. Business failures use onError and retry.
  void done.catch(() => {});
  const requestStop = () => {
    stopping = true;
    if (timer !== undefined) { clearTimer(timer); release(); }
  };
  return Object.freeze({
    requestStop,
    async stop() { requestStop(); await done; }
  });
}
