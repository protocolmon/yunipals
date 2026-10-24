import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ResponseBodyTooLargeError,
  TimeoutError,
  type HttpTransportConfig
} from "viem";
import { buildSourceManifest } from "../lib/unified/sources.js";
import { unifiedRpcHttpTransport } from "../lib/unified/rpc-preflight.js";
import {
  unifiedRpcProfileId,
  type UnifiedRpcProfile
} from "../../../packages/yunipals-indexer-server/src/rpc-policy.js";

type Call = { id: number | string; method: string; params?: unknown[] };
type Fetch = NonNullable<HttpTransportConfig["fetchFn"]>;
const directory = await mkdtemp(join(tmpdir(), "yunipals-generic-deadline-"));
const profileFile = join(directory, "profile.json");
const profile: UnifiedRpcProfile = {
  version: 1,
  model: "alchemy-2026-09-08",
  scope: "rpc-deadline-test",
  coordinatorId: "12345678-1234-4123-8123-123456789012",
  manifest: buildSourceManifest({}),
  limits: { batchCalls: 10, logRange: 500, addresses: 50, topicValues: 32 }
};
await writeFile(profileFile, JSON.stringify(profile));
const env = {
  UNIFIED_RPC_POLICY_REQUIRED: "true",
  UNIFIED_RPC_PROFILE_FILE: profileFile,
  UNIFIED_RPC_PROFILE_ID: unifiedRpcProfileId(profile)
};
beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw Error("real_network_forbidden");
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => rm(directory, { recursive: true, force: true }));

function requests(init?: RequestInit): Call[] {
  assert.equal(typeof init?.body, "string");
  const value = JSON.parse(init!.body as string) as Call | Call[];
  return Array.isArray(value) ? value : [value];
}
function reply(init?: RequestInit) {
  const calls = requests(init);
  const values = calls.map((call) => ({
    jsonrpc: "2.0",
    id: call.id,
    result: "0x1"
  }));
  return new Response(
    JSON.stringify(
      Array.isArray(JSON.parse(init!.body as string)) ? values : values[0]
    ),
    { headers: { "content-type": "application/json" } }
  );
}
function client(
  fetchFn: Fetch,
  workload: "unified_source" | "unified_evidence" = "unified_source",
  timeout = 30
) {
  return unifiedRpcHttpTransport(
    "http://fixture.invalid/unified",
    8453,
    workload,
    env,
    {
      timeout,
      retryCount: 0,
      fetchFn
    }
  )({ timeout, retryCount: 0 });
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(Error("fixture_outer_deadline")), 1000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

it("generic factory enforces its deadline despite the retained scheduler signal", async () => {
  let attempts = 0;
  const configured = client(async () => {
    attempts++;
    return new Promise<Response>(() => {});
  });
  await bounded(
    expect(
      configured.request({ method: "eth_chainId" })
    ).rejects.toBeInstanceOf(TimeoutError)
  );
  expect(attempts).toBe(1);
});

it("generic body timeout remains bounded without adding the combined Base FIFO", async () => {
  let cancellations = 0;
  const configured = client(async (_url, init) =>
    requests(init)[0]!.method !== "eth_getLogs"
      ? reply(init)
      : new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancellations++;
            }
          }),
          {
            headers: { "content-type": "application/json" }
          }
        )
  );
  const logs = configured.request({
    method: "eth_getLogs",
    params: [{ fromBlock: "0x1", toBlock: "0x2" }]
  });
  const timeout = expect(logs).rejects.toBeInstanceOf(TimeoutError);
  expect(await bounded(configured.request({ method: "eth_chainId" }))).toBe(
    "0x1"
  );
  await bounded(timeout);
  expect(cancellations).toBe(1);
});

it("generic source and evidence keep their existing batches and policy headers", async () => {
  const seen: Array<{ count: number; headers: Headers }> = [];
  const fetchFn: Fetch = async (_url, init) => {
    seen.push({
      count: requests(init).length,
      headers: new Headers(init?.headers)
    });
    return reply(init);
  };
  const source = client(fetchFn, "unified_source", 500),
    evidence = client(fetchFn, "unified_evidence", 500);
  const signal = new AbortController().signal;
  await bounded(
    Promise.all([
      source.request({ method: "eth_chainId" }, { signal }),
      source.request({ method: "eth_blockNumber" }, { signal }),
      evidence.request({ method: "eth_chainId" }, { signal }),
      evidence.request({ method: "eth_blockNumber" }, { signal })
    ])
  );
  expect(seen).toHaveLength(2);
  expect(seen.map((row) => row.count)).toEqual([2, 2]);
  expect(
    new Set(seen.map((row) => row.headers.get("x-yunipals-rpc-workload")))
  ).toEqual(new Set(["unified_source", "unified_evidence"]));
  for (const row of seen) {
    expect(row.headers.get("x-yunipals-unified-rpc-profile")).toBe(
      env.UNIFIED_RPC_PROFILE_ID
    );
    expect(row.headers.has("x-yunipals-unified-rpc-permit")).toBe(false);
  }
});

it("generic viem streaming size refusal cannot await a stalled cancellation", async () => {
  let cancellations = 0;
  const configured = client(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(10_485_761));
          },
          cancel() {
            cancellations++;
            return new Promise<void>(() => {});
          }
        }),
        { headers: { "content-type": "application/json" } }
      ),
    "unified_evidence",
    500
  );
  await bounded(
    expect(
      configured.request({ method: "eth_chainId" })
    ).rejects.toBeInstanceOf(ResponseBodyTooLargeError)
  );
  expect(cancellations).toBe(1);
});

const parse = (text: string) =>
  ts.createSourceFile(
    "source.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
function shape(node: ts.Node): unknown {
  const children: unknown[] = [];
  ts.forEachChild(node, (child) => {
    children.push(shape(child));
  });
  return {
    kind: node.kind,
    text:
      ts.isLiteralExpression(node) || ts.isIdentifier(node)
        ? node.text
        : undefined,
    isTypeOnly: "isTypeOnly" in node ? node.isTypeOnly : undefined,
    children
  };
}

it("shared helper is identical to the reviewed standalone implementation", () => {
  const shared = parse(
    readFileSync(
      new URL("../lib/unified/rpc-call-deadline.ts", import.meta.url),
      "utf8"
    )
  );
  const standalone = parse(
    readFileSync(
      new URL(
        "../../../ops/unified-indexer-transition/ypal-rpc-deadline-v1/rpc-preflight.ts",
        import.meta.url
      ),
      "utf8"
    )
  );
  const helper = (file: ts.SourceFile) =>
    file.statements.find(
      (node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) && node.name?.text === "boundedRpcFetch"
    );
  expect(helper(shared)).toBeDefined();
  expect(shape(helper(shared)!)).toEqual(shape(helper(standalone)!));
});

it("generic application delta preserves endpoints and all other transport logic", () => {
  const baseline = readFileSync(
    new URL("../lib/unified/rpc-preflight-source-v3.ts", import.meta.url),
    "utf8"
  );
  expect(createHash("sha256").update(baseline).digest("hex")).toBe(
    "68a0d4fd0442ecb464574434e1e349f1e4caf1c4ab2f0a70352f8b5f26afe833"
  );
  const source = parse(
    readFileSync(
      new URL("../lib/unified/rpc-preflight.ts", import.meta.url),
      "utf8"
    )
  );
  const transformed = ts.transform(source, [
    (context) => {
      const visit: ts.Visitor = (node) => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text === "./rpc-call-deadline.js"
        )
          return undefined;
        if (
          ts.isVariableStatement(node) &&
          node.declarationList.declarations.some(
            (row) =>
              ts.isIdentifier(row.name) && row.name.text === "boundedHttp"
          )
        )
          return undefined;
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "boundedHttp"
        )
          return ts.factory.updateCallExpression(
            node,
            ts.factory.createIdentifier("http"),
            node.typeArguments,
            [ts.factory.createIdentifier("url"), ...node.arguments]
          );
        return ts.visitEachChild(node, visit, context);
      };
      return (file) => ts.visitNode(file, visit) as ts.SourceFile;
    }
  ]);
  expect(
    shape(parse(ts.createPrinter().printFile(transformed.transformed[0]!)))
  ).toEqual(shape(parse(baseline)));
  transformed.dispose();
});
