import { useEffect, useMemo, useState } from "react";

export function useArenaClock(serverTime?: number) {
  const [, setTick] = useState(0);
  const anchor = useMemo(
    () => ({ serverTime, received: performance.now() }),
    [serverTime]
  );
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return serverTime === undefined
    ? Math.floor(Date.now() / 1000)
    : serverTime + Math.floor((performance.now() - anchor.received) / 1000);
}
