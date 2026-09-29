import { BnbOrderError } from "@/bnb/orders";

type Waiting = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** A held transaction must not rely on pg's unbounded internal query queue. */
export class CatalogLeaseQueue {
  private held = false;
  private readonly waiting: Waiting[] = [];
  private closed?: Error;

  constructor(
    private readonly timeoutMs = 1500,
    private readonly maximum = 8
  ) {}

  get active() {
    return this.held;
  }

  async acquire(): Promise<() => void> {
    if (this.closed) throw this.closed;
    if (!this.held) {
      this.held = true;
      return this.release();
    }
    if (this.waiting.length >= this.maximum)
      throw new BnbOrderError("catalog_busy", 429);
    return new Promise((resolve, reject) => {
      const entry: Waiting = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new BnbOrderError("catalog_busy", 429));
        }, this.timeoutMs)
      };
      this.waiting.push(entry);
    });
  }

  close(error: Error): void {
    this.closed = error;
    for (const entry of this.waiting.splice(0)) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  private release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const entry = this.waiting.shift();
      if (entry) {
        clearTimeout(entry.timer);
        entry.resolve(this.release());
      } else this.held = false;
    };
  }
}
