const reloadKey = "yunipals/lazy-asset-reload/v1";

export function isLazyAssetError(value: unknown): boolean {
  const message =
    value && typeof value === "object" && "message" in value
      ? value.message
      : undefined;
  return (
    typeof message === "string" &&
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS for/i.test(
      message
    )
  );
}

export function tryLazyLoadRecovery(
  error: unknown,
  storage: Pick<Storage, "getItem" | "setItem">,
  reload: () => void,
  canReload = true
): boolean {
  if (!canReload || !isLazyAssetError(error)) return false;
  try {
    if (storage.getItem(reloadKey) !== null) return false;
    // Persist before navigation. Never clear transaction or wallet storage.
    storage.setItem(reloadKey, "attempted");
    if (storage.getItem(reloadKey) !== "attempted") return false;
    reload();
    return true;
  } catch {
    return false;
  }
}

export function registerLazyLoadRecovery(target: Window = window) {
  const recover = (event: Event) => {
    try {
      const payload = (event as Event & { payload?: unknown }).payload;
      tryLazyLoadRecovery(
        payload,
        target.sessionStorage,
        () => target.location.reload(),
        !target.document.querySelector(
          'dialog[open], [role="dialog"][aria-modal="true"]'
        )
      );
    } catch {
      // The original rejection still reaches React's visible error boundary.
    }
  };
  target.addEventListener("vite:preloadError", recover);
  return () => target.removeEventListener("vite:preloadError", recover);
}
