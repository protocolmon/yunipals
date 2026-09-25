export function createShutdownDeadline(
  deadlineMs?: number
): (exitCode: 0 | 1) => void;
