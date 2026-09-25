import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";

export async function fixtureProvider(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
) {
  const server = createServer((req, res) => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(() => res.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string")
    throw new Error("Fixture server has no address.");
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  };
}

export async function fixtureJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString()) as Record<
    string,
    unknown
  >;
}

export function fixtureJsonResponse(res: ServerResponse, data: unknown) {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(data));
}
