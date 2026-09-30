import { describe, expect, it, vi } from "vitest";
import { ExactCountCache } from "../lib/api/exact-count-cache.js";

describe("ExactCountCache", () => {
  it("bounds distinct cold loaders while allowing shared consumers", async () => {
    const cache = new ExactCountCache(1000, 10, 1);
    let complete!: (value: number) => void;
    const load = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          complete = resolve;
        })
    );
    const first = cache.get("a", load);
    const shared = cache.get("a", load);
    await expect(cache.get("b", async () => 2)).rejects.toMatchObject({
      code: "53300"
    });
    complete(1);
    expect((await first).value).toBe(1);
    expect((await shared).value).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect((await cache.get("b", async () => 2)).value).toBe(2);
  });
  it("coalesces concurrent exact counts and reuses the result", async () => {
    const cache = new ExactCountCache(1_000, 10);
    const load = vi.fn(async () => 42);
    const [first, second] = await Promise.all([
      cache.get("a", load),
      cache.get("a", load)
    ]);
    expect(first.value).toBe(42);
    expect(second.value).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
    expect((await cache.get("a", load)).hit).toBe(true);
  });

  it("expires and bounds cached entries", async () => {
    vi.useFakeTimers();
    const cache = new ExactCountCache(10, 1);
    await cache.get("a", async () => 1);
    await cache.get("b", async () => 2);
    expect((await cache.get("a", async () => 3)).value).toBe(3);
    vi.advanceTimersByTime(11);
    expect((await cache.get("a", async () => 4)).value).toBe(4);
    vi.useRealTimers();
  });
});
