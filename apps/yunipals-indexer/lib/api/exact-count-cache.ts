type Entry = { value: number; expiresAt: number };

export class ExactCountCache {
  private readonly values = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<number>>();

  constructor(private readonly ttlMs = 15_000, private readonly maxEntries = 1_000) {}

  async get(key: string, load: () => Promise<number>) {
    const now = Date.now();
    const cached = this.values.get(key);
    if (cached && cached.expiresAt > now) {
      this.values.delete(key);
      this.values.set(key, cached);
      return { value: cached.value, hit: true };
    }
    if (cached) this.values.delete(key);
    const existing = this.pending.get(key);
    if (existing) return { value: await existing, hit: true };

    const promise = load();
    this.pending.set(key, promise);
    try {
      const value = await promise;
      this.values.set(key, { value, expiresAt: Date.now() + this.ttlMs });
      while (this.values.size > this.maxEntries) this.values.delete(this.values.keys().next().value!);
      return { value, hit: false };
    } finally {
      this.pending.delete(key);
    }
  }
}
