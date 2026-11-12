/** Limits how long a request may use a read set whose data changed.
 *
 * The read-cache worker rebuilds a changed set within a minute or two. Until
 * then its stored counts are behind by those changes at most. If no rebuild
 * arrives within the grace period, callers return to the exact path, which is
 * slow and correct. The period starts when this process first sees the change.
 */
export class RebuildGrace {
  private readonly changedSince = new Map<string, number>();

  /** A period of 0 turns the grace off. */
  constructor(private readonly graceMs: number) {
    if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 3_600_000)
      throw new Error("rebuild_grace_out_of_bounds");
  }

  /** `fresh`: nothing changed. `usable`: valid apart from changed data. */
  allows(
    key: string,
    state: { fresh: boolean; usable: boolean },
    now = Date.now()
  ) {
    if (state.fresh) {
      this.changedSince.delete(key);
      return false;
    }
    if (!state.usable) return false;
    const since = this.changedSince.get(key) ?? now;
    this.changedSince.set(key, since);
    return now - since < this.graceMs;
  }
}
