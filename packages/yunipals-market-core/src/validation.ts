import { getAddress, maxUint256, type Address, type Hex } from "viem";

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid marketplace response.");
  return value as Record<string, unknown>;
}
export function string(value: unknown, maxLength = 128) {
  if (typeof value !== "string" || !value.length || value.length > maxLength)
    throw new Error("Invalid marketplace text.");
  return value;
}
export function enumeration<const T extends readonly string[]>(
  value: unknown,
  options: T
): T[number] {
  if (typeof value !== "string" || !options.includes(value))
    throw new Error("Unsupported marketplace value.");
  return value;
}
export function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  )
    throw new Error("Invalid marketplace integer.");
  return value;
}
export function decimal(value: unknown) {
  const result = string(value, 78);
  if (!/^(0|[1-9][0-9]*)$/.test(result) || BigInt(result) > maxUint256)
    throw new Error("Invalid marketplace amount.");
  return result;
}
export function address(value: unknown): Address {
  const result = string(value, 42);
  if (!/^0x[0-9a-fA-F]{40}$/.test(result))
    throw new Error("Invalid marketplace address.");
  return getAddress(result);
}
export function hex(value: unknown, bytes?: number): Hex {
  const result = string(value, bytes ? 2 + bytes * 2 : 32_770);
  if (
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(result) ||
    (bytes && result.length !== 2 + bytes * 2)
  )
    throw new Error("Invalid marketplace hex value.");
  return result.toLowerCase() as Hex;
}
export function boolean(value: unknown) {
  if (typeof value !== "boolean") throw new Error("Invalid marketplace flag.");
  return value;
}
export function array<T>(
  value: unknown,
  parse: (item: unknown) => T,
  max = 100
) {
  if (!Array.isArray(value) || value.length > max)
    throw new Error("Invalid marketplace list.");
  return value.map(parse);
}
export function version(value: unknown, expected = 1) {
  const data = record(value);
  if (
    !Number.isSafeInteger(expected) ||
    expected < 1 ||
    data.schemaVersion !== expected
  )
    throw new Error("This marketplace API version is not supported.");
  return data;
}

export function pageToken(value: unknown) {
  const token = string(value, 256);
  if (!/^[a-zA-Z0-9_-]+$/.test(token))
    throw new Error("Invalid order-history page token.");
  return token;
}
