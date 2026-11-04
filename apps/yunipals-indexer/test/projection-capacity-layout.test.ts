import { describe, expect, it } from "vitest";
import {
  remainingWalHeadroom,
  verifyFilesystemBudgets
} from "../lib/metadata/projection-capacity-layout.js";
const gb = 1e9;
const observe = async (path: string) =>
  path.startsWith("/volume")
    ? { device: 2, freeBytes: 105 * gb }
    : { device: 1, freeBytes: 41 * gb };
describe("projection filesystem budgets", () => {
  it("keeps the same WAL peak and free reserve as allocated segments consume and release disk space", async () => {
    for (const allocated of [0, 2 * gb, 8 * gb, 24 * gb]) {
      const required = remainingWalHeadroom(16 * gb, 0, allocated);
      const result = await verifyFilesystemBudgets(
        [{ name: "remaining WAL growth", path: "/wal", bytes: required }],
        25 * gb,
        async () => ({ device: 1, freeBytes: 50 * gb - allocated })
      );
      expect(result[0]!.freeBytes - result[0]!.requiredBytes).toBe(gb);
    }
    expect(remainingWalHeadroom(16 * gb, 5 * gb, 8 * gb)).toBe(21 * gb);
    expect(() => remainingWalHeadroom(16 * gb, 0, NaN)).toThrow();
  });
  it("allows independent data and WAL disks while retaining backup and per-disk reserves", async () => {
    const result = await verifyFilesystemBudgets(
      [
        { name: "WAL", path: "/postgres/wal", bytes: 15 * gb },
        { name: "generation", path: "/volume/derived", bytes: 10 * gb },
        { name: "snapshot", path: "/volume/temp", bytes: 6 * gb },
        { name: "backup", path: "/volume/backups", bytes: 35 * gb }
      ],
      25 * gb,
      observe
    );
    expect(result.map((x) => x.requiredBytes)).toEqual([40 * gb, 76 * gb]);
  });
  it("refuses a full WAL disk even when the other disk has ample space", async () => {
    await expect(
      verifyFilesystemBudgets(
        [
          { name: "WAL", path: "/postgres/wal", bytes: 17 * gb },
          { name: "generation", path: "/volume/derived", bytes: 10 * gb }
        ],
        25 * gb,
        observe
      )
    ).rejects.toThrow("device=1");
  });
  it("does not count free space twice when paths share a filesystem", async () => {
    await expect(
      verifyFilesystemBudgets(
        [
          { name: "generation", path: "/volume/derived", bytes: 50 * gb },
          { name: "backup", path: "/volume/backups", bytes: 35 * gb }
        ],
        25 * gb,
        observe
      )
    ).rejects.toThrow("device=2");
  });
  it("charges a reserve only once even when all paths share a filesystem", async () => {
    const result = await verifyFilesystemBudgets(
      [
        { name: "generation", path: "/volume/derived", bytes: 10 * gb },
        { name: "snapshot", path: "/volume/temp", bytes: 6 * gb },
        { name: "backup", path: "/volume/backups", bytes: 35 * gb }
      ],
      25 * gb,
      observe
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.requiredBytes).toBe(76 * gb);
  });
  it("rejects invalid allocation values and relative paths", async () => {
    for (const bad of [
      { path: "relative", bytes: 1 },
      { path: "/data", bytes: -1 },
      { path: "/data", bytes: NaN }
    ])
      await expect(
        verifyFilesystemBudgets([{ name: "bad", ...bad }], 25 * gb, observe)
      ).rejects.toThrow("Invalid filesystem charge");
  });
});
