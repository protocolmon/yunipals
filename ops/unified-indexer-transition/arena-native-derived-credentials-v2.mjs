// Parse only the exact already-acknowledged native and public credential forms.
export function existingCredentialUrl(raw, key, nativeRelease, native) {
  const rows = raw.toString("utf8").trim().split("\n");
  const need = (value) => { if (!value) throw new Error("exact_existing_derived_credential_selectors_required"); };
  if (native) {
    need(key === "ARENA_INDEXER_DATABASE_URL" && /^0x[a-f0-9]{64}$/.test(nativeRelease) && rows.length === 4 &&
      rows[0] === "ARENA_INDEXER_MODE=unified" && rows[1] === "ARENA_INDEXER_SOURCE_KIND=unified" &&
      rows[2] === "ARENA_INDEXER_RELEASE_ID=" + nativeRelease && rows[3].startsWith(key + "=") &&
      rows[3].length > key.length + 1);
    return rows[3].slice(key.length + 1);
  }
  need(key === "ARENA_PUBLIC_ROLLBACK_DATABASE_URL" && rows.length === 1 && rows[0].startsWith(key + "=") &&
    rows[0].length > key.length + 1);
  return rows[0].slice(key.length + 1);
}
