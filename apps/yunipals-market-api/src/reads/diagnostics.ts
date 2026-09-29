import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type ReadDiagnostics = {
  requestId: string;
  route: string;
  startedAt: number;
  filterHash?: string;
  sort?: string;
  phase?: string;
  snapshotAgeMs?: number;
  projectionGeneration?: string | null;
  queueWaitMs?: number;
  executionMs?: number;
};

export const readDiagnostics = new AsyncLocalStorage<ReadDiagnostics>();

export function createReadDiagnostics(route: string): ReadDiagnostics {
  return { requestId: randomUUID(), route, startedAt: performance.now() };
}

export function annotateRead(fields: Partial<ReadDiagnostics>): void {
  const current = readDiagnostics.getStore();
  if (current) Object.assign(current, fields);
}

export function readFailureContext() {
  const current = readDiagnostics.getStore();
  if (!current) return {};
  const { startedAt, ...fields } = current;
  return { ...fields, totalMs: Math.round(performance.now() - startedAt) };
}
