import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Open the private receipt BEFORE paying for a request. Preserve its original
 * bytes before parsing or database work, including partial bodies on failure. */
export async function animeDirectorCapture(folder: string, requestId: string) {
  if (!/^[0-9a-f-]{36}$/.test(requestId))
    throw new Error("Invalid director request ID.");
  const directory = join(folder, "provider-receipts");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = await open(
    join(directory, `${requestId}.response`),
    "wx",
    0o600
  );
  return {
    async read(response: Response) {
      await writeFile(
        join(directory, `${requestId}.headers.json`),
        JSON.stringify({
          status: response.status,
          clientRequestId: requestId,
          contentType: response.headers.get("content-type"),
          generationId: response.headers.get("x-generation-id"),
          requestId: response.headers.get("x-request-id")
        }),
        { flag: "wx", mode: 0o600 }
      );
      if (!response.ok || !response.body)
        throw new Error("Director submission failed.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.length;
          if (bytes > 256000)
            throw new Error("Director response exceeds its size limit.");
          await file.writeFile(next.value);
          chunks.push(next.value);
        }
        await file.sync();
        return Buffer.concat(chunks).toString("utf8");
      } finally {
        // Cleanup cannot invalidate a fully received response.
        await reader.cancel().catch(() => {});
        await file.sync();
      }
    },
    close: () => file.close()
  };
}
