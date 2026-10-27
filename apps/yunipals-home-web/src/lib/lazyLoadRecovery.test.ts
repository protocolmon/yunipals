import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isLazyAssetError,
  registerLazyLoadRecovery,
  tryLazyLoadRecovery
} from "./lazyLoadRecovery";

function memory() {
  const rows = new Map<string, string>([
    ["saved-pending-transaction", "0x123"]
  ]);
  return {
    rows,
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    }
  };
}
const missing = new TypeError(
  "Failed to fetch dynamically imported module: https://www.yunipals.com/assets/LiveArenaPage-old.js"
);

test("a recognized preload failure reloads once across document instances and preserves saved transactions", () => {
  const storage = memory();
  let reloads = 0;
  assert.equal(
    tryLazyLoadRecovery(missing, storage, () => reloads++),
    true
  );
  assert.equal(
    tryLazyLoadRecovery(missing, storage, () => reloads++),
    false
  );
  assert.equal(reloads, 1);
  assert.equal(storage.getItem("saved-pending-transaction"), "0x123");
});
test("ordinary React exceptions are never automatically retried or masked", () => {
  const storage = memory();
  assert.equal(
    tryLazyLoadRecovery(
      new TypeError("Cannot read properties of undefined"),
      storage,
      () => assert.fail()
    ),
    false
  );
  assert.equal(storage.rows.size, 1);
  assert.equal(isLazyAssetError({ message: 42 }), false);
});
test("an active review dialog blocks automatic navigation", () => {
  const storage = memory();
  assert.equal(
    tryLazyLoadRecovery(missing, storage, () => assert.fail(), false),
    false
  );
  assert.equal(storage.rows.size, 1);
});
test("unavailable or ineffective storage cannot create a reload loop", () => {
  for (const storage of [
    {
      getItem: () => {
        throw Error("disabled");
      },
      setItem: () => {}
    },
    {
      getItem: () => null,
      setItem: () => {
        throw Error("full");
      }
    },
    { getItem: () => null, setItem: () => {} }
  ])
    assert.equal(
      tryLazyLoadRecovery(missing, storage, () => assert.fail()),
      false
    );
});
test("Safari and Vite stylesheet preload errors receive the same finite recovery", () => {
  for (const message of [
    "Importing a module script failed.",
    "error loading dynamically imported module",
    "Unable to preload CSS for /assets/old.css"
  ])
    assert.equal(
      tryLazyLoadRecovery(new Error(message), memory(), () => {}),
      true
    );
});
test("only the Vite event is handled, no original rejection is suppressed, and cleanup removes the listener", () => {
  const events = new EventTarget(),
    storage = memory();
  let reloads = 0;
  const target = Object.assign(events, {
    sessionStorage: storage,
    document: { querySelector: () => null },
    location: { reload: () => reloads++ }
  }) as unknown as Window;
  const cleanup = registerLazyLoadRecovery(target);
  const event = Object.assign(
    new Event("vite:preloadError", { cancelable: true }),
    { payload: missing }
  );
  target.dispatchEvent(event);
  target.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(reloads, 1);
  cleanup();
  storage.rows.clear();
  target.dispatchEvent(event);
  assert.equal(reloads, 1);
});
