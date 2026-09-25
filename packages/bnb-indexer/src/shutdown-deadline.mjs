// Arm before asynchronous error persistence and cleanup. Keep the timer unrefed:
// successful cleanup exits naturally, but lingering sockets cannot hide failure.
export function createShutdownDeadline(deadlineMs = 15000) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 15000)
    throw new Error("Invalid shutdown deadline.");
  let timer;
  return (exitCode) => {
    if (exitCode !== 0 && exitCode !== 1)
      throw new Error("Invalid shutdown exit code.");
    if (exitCode === 1 || process.exitCode === undefined)
      process.exitCode = exitCode;
    if (timer) return;
    timer = setTimeout(() => {
      // Exceeding a graceful shutdown deadline is also an operational failure.
      process.exit(1);
    }, deadlineMs);
    timer.unref();
  };
}
