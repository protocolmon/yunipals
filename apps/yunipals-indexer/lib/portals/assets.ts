import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, link, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stablePortalJson } from "@protopals/yunipals-market-core/portals";
import type { Hex } from "viem";

export function portalAssetHash(bytes: Uint8Array): Hex {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

export class PortalAssets {
  readonly directory: string;
  readonly origin: string;
  constructor(
    directory: string,
    origin: string,
    readonly allowedHosts: readonly string[],
    readonly ipfsGateway?: string,
    readonly sharedRead = false
  ) {
    this.directory = resolve(directory);
    const url = new URL(origin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Portal public origin must use HTTPS.");
    this.origin = url.href.replace(/\/$/, "");
  }

  async put(bytes: Uint8Array, extension: "png" | "json") {
    const hash = portalAssetHash(bytes);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, `${hash.slice(2)}.${extension}`);
    const temporary = join(this.directory, `.${randomUUID()}.pending`);
    try {
      const file = await open(temporary, "wx", this.sharedRead ? 0o640 : 0o600);
      try {
        if (this.sharedRead) await file.chmod(0o640);
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        await link(temporary, path);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "EEXIST"
        )
          throw error;
        if (portalAssetHash(await readFile(path)) !== hash)
          throw new Error("Portal artifact storage is corrupt.");
      }
      const directory = await open(this.directory, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await rm(temporary, { force: true });
    }
    return {
      hash,
      uri: `${this.origin}/v1/portals/assets/${hash.slice(2)}.${extension}`
    };
  }

  async putJson(value: unknown) {
    return this.put(Buffer.from(stablePortalJson(value)), "json");
  }

  async read(hash: string, extension: "png" | "json") {
    if (!/^[0-9a-f]{64}$/.test(hash))
      throw new Error("Invalid portal asset hash.");
    const bytes = await readFile(join(this.directory, `${hash}.${extension}`));
    if (portalAssetHash(bytes) !== `0x${hash}`)
      throw new Error("Portal artifact hash mismatch.");
    return bytes;
  }

  async input(uri: string, expectedHash: Hex): Promise<Uint8Array> {
    const prefix = `${this.origin}/v1/portals/assets/`;
    if (uri.startsWith(prefix)) {
      const match = /^([0-9a-f]{64})\.png$/.exec(uri.slice(prefix.length));
      if (!match) throw new Error("Invalid card artwork reference.");
      const bytes = await this.read(match[1], "png");
      if (portalAssetHash(bytes) !== expectedHash)
        throw new Error("Input artwork hash mismatch.");
      return bytes;
    }
    if (uri.startsWith("ipfs://")) {
      if (!this.ipfsGateway) throw new Error("IPFS gateway is not configured.");
      const path = uri.slice(7);
      if (!/^[a-zA-Z0-9]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(path))
        throw new Error("Invalid IPFS reference.");
      uri = `${this.ipfsGateway.replace(/\/$/, "")}/${path}`;
    }
    const url = new URL(uri);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !this.allowedHosts.includes(url.hostname)
    )
      throw new Error("Input artwork host is not approved.");
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok)
      throw new Error(`Input artwork unavailable (${response.status}).`);
    if (Number(response.headers.get("content-length") ?? 0) > 12 * 1024 * 1024)
      throw new Error("Input artwork is too large.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Input artwork is empty.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 12 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Input artwork is too large.");
      }
      chunks.push(part.value);
    }
    const bytes = Buffer.concat(chunks);
    if (portalAssetHash(bytes) !== expectedHash)
      throw new Error("Input artwork hash mismatch.");
    if (
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error("Expected PNG card artwork.");
    return bytes;
  }
}
