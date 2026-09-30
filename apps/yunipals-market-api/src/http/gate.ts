// Bounds both admission rate and outstanding work. Caller keys come only from
// the transport peer, never untrusted forwarded headers or maker addresses.
export function createWorkGate(input: {
  burst: number;
  perSecond: number;
  concurrent: number;
  now?: () => number;
}) {
  const now = input.now ?? performance.now.bind(performance);
  const callers = new Map<string, { tokens: number; updatedAt: number }>();
  let active = 0;
  let rejection: "concurrency" | "caller_capacity" | "rate" | undefined;
  return {
    get rejection() {
      return rejection;
    },
    acquire(caller: string) {
      rejection = undefined;
      const time = now();
      if (active >= input.concurrent) {
        rejection = "concurrency";
        return null;
      }
      if (!callers.has(caller) && callers.size >= 1024) {
        for (const [key, value] of callers) {
          if (time - value.updatedAt > (input.burst / input.perSecond) * 1000)
            callers.delete(key);
        }
        if (callers.size >= 1024) {
          rejection = "caller_capacity";
          return null;
        }
      }
      const bucket = callers.get(caller) ?? {
        tokens: input.burst,
        updatedAt: time
      };
      bucket.tokens = Math.min(
        input.burst,
        bucket.tokens + ((time - bucket.updatedAt) * input.perSecond) / 1000
      );
      bucket.updatedAt = time;
      callers.set(caller, bucket);
      if (bucket.tokens < 1) {
        rejection = "rate";
        return null;
      }
      bucket.tokens--;
      active++;
      let released = false;
      return () => {
        if (!released) active--;
        released = true;
      };
    }
  };
}
