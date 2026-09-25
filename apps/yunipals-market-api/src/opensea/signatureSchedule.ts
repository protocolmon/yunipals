import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";

export const signatureChains = ["ethereum", "base", "polygon"] as const;

/** Only scheduling position lives here; order jobs and proofs remain in SQL. */
export class SignatureSchedule {
  private constructor(
    private readonly directory: string,
    public next: OpenSeaChain,
    public notBefore = 0
  ) {}

  static async load(directory: string) {
    const stat = await lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.uid !== process.getuid?.() ||
      stat.mode & 0o077
    )
      throw new Error(
        "Signature schedule needs a private owned state directory."
      );
    let next: OpenSeaChain = "ethereum";
    let notBefore = 0;
    let file;
    try {
      file = await open(
        join(directory, "schedule.json"),
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (file) {
      try {
        const info = await file.stat();
        if (
          !info.isFile() ||
          info.size > 256 ||
          info.uid !== process.getuid?.() ||
          info.mode & 0o077
        )
          throw new Error("Invalid signature schedule file.");
        const value = JSON.parse(await file.readFile("utf8")) as {
          version?: unknown;
          next?: unknown;
          notBefore?: unknown;
        };
        if (
          value.version !== 1 ||
          !signatureChains.some((chain) => chain === value.next)
        )
          throw new Error("Invalid signature schedule state.");
        next = value.next as OpenSeaChain;
        if (value.notBefore !== undefined) {
          if (
            typeof value.notBefore !== "number" ||
            !Number.isSafeInteger(value.notBefore) ||
            value.notBefore < 0 ||
            value.notBefore > Date.now() + 120000
          )
            throw new Error("Invalid signature schedule delay.");
          notBefore = value.notBefore;
        }
      } finally {
        await file.close();
      }
    }
    return new SignatureSchedule(directory, next, notBefore);
  }

  async advance(persist: boolean) {
    const next =
      signatureChains[
        (signatureChains.indexOf(this.next) + 1) % signatureChains.length
      ]!;
    if (persist) await this.save(next, 0);
    this.next = next;
    this.notBefore = 0;
  }

  async defer() {
    // Budget-deferred jobs become due after 60 seconds. Preserve the chain and
    // that wait across restart instead of incorrectly treating it as idle.
    const notBefore = Date.now() + 60000;
    await this.save(this.next, notBefore);
    this.notBefore = notBefore;
  }

  private async save(next: OpenSeaChain, notBefore: number) {
    const temporary = join(this.directory, `.schedule-${randomUUID()}`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(
          JSON.stringify({ version: 1, next, notBefore }) + "\n"
        );
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, join(this.directory, "schedule.json"));
      const directory = await open(this.directory, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}
