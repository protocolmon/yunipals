// These are short read transactions, separate from the catalog snapshot pool.
// Keep the existing default; rollout configuration may reduce each worker's cap.
export function sourcePoolMax(value = 4) {
  if (!Number.isInteger(value) || value < 1 || value > 4)
    throw new Error("Source reader pool size must be an integer from 1 to 4.");
  return value;
}

export function readSourcePoolMax(value: string | undefined) {
  if (value === undefined) return sourcePoolMax();
  if (!/^[1-4]$/.test(value))
    throw new Error("Source reader pool size must be an integer from 1 to 4.");
  return sourcePoolMax(Number(value));
}
