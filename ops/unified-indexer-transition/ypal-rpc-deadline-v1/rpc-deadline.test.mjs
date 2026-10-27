import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const baseline = new URL(
  "../ypal-combined-source-v1/payload/rpc-preflight.ts",
  import.meta.url
);
const candidate = new URL("rpc-preflight.ts", import.meta.url);
const viem = new URL(
  "node_modules/.pnpm/viem@2.55.13_bufferutil@4.1.0_typescript@5.7.3_utf-8-validate@5.0.10_zod@3.24.2/node_modules/viem/_esm/index.js",
  pathToFileURL(root)
);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const require = createRequire(
  new URL("../../../apps/yunipals-indexer/package.json", import.meta.url)
);
const ts = require("typescript");
assert.equal(
  sha(readFileSync(baseline)),
  "15d2157d5fd126d1d63383186b037d14b767314c2bf9552ee379cfffa869ca91"
);
assert.equal(
  sha(readFileSync(viem)),
  "ea32975364e9f2d599b10639d81985ec6a3ed87f6942fe0cb73b1bf738959057"
);
registerHooks({
  resolve(specifier, context, next) {
    if ([baseline.href, candidate.href].includes(context.parentURL)) {
      if (specifier.startsWith("../../../../packages/"))
        return next(
          new URL(specifier.replace("../../../../", ""), pathToFileURL(root))
            .href,
          context
        );
      if (specifier === "./sources.js")
        return next(
          new URL(
            "apps/yunipals-indexer/lib/unified/sources.ts",
            pathToFileURL(root)
          ).href,
          context
        );
      if (specifier === "viem") return next(viem.href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if ([baseline.href, candidate.href].includes(url))
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022
          }
        }).outputText
      };
    return next(url, context);
  }
});
let realFetchCalls = 0;
globalThis.fetch = () => {
  realFetchCalls++;
  throw Error("real_network_forbidden");
};
const original = await import(baseline.href);
const fixed = await import(candidate.href);
const { TimeoutError, ResponseBodyTooLargeError } = await import(viem.href);
const { unifiedRpcProfileId } = await import(
  new URL(
    "packages/yunipals-indexer-server/src/rpc-policy.ts",
    pathToFileURL(root)
  ).href
);
const profileFile = fileURLToPath(
  new URL("../ypal-combined-rpc-profile-v1.json", import.meta.url)
);
const profile = JSON.parse(readFileSync(profileFile));
const env = {
  UNIFIED_RPC_POLICY_REQUIRED: "true",
  UNIFIED_RPC_PROFILE_FILE: profileFile,
  UNIFIED_RPC_PROFILE_ID: unifiedRpcProfileId(profile)
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const calls = (init) => {
  const value = JSON.parse(init.body);
  return Array.isArray(value) ? value : [value];
};
const reply = (init, result = "0x2105") => {
  const value = JSON.parse(init.body),
    item = (call) => ({ jsonrpc: "2.0", id: call.id, result });
  return new Response(
    JSON.stringify(Array.isArray(value) ? value.map(item) : item(value)),
    { headers: { "content-type": "application/json" } }
  );
};
const logs = (from = 1) => ({
  method: "eth_getLogs",
  params: [
    {
      address: "0x" + "11".repeat(20),
      fromBlock: `0x${from.toString(16)}`,
      toBlock: `0x${(from + 1).toString(16)}`
    }
  ]
});
function client(
  module,
  fetchFn,
  {
    chain = 8453,
    workload = "unified_source",
    timeout = 30,
    configuredTimeout = timeout
  } = {}
) {
  return module.unifiedRpcHttpTransport(
    "http://fixture.invalid/unified",
    chain,
    workload,
    env,
    { retryCount: 0, timeout: configuredTimeout, fetchFn }
  )({ retryCount: 0, timeout });
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(Error("local_test_outer_deadline")),
          1500
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("exact frozen transport reproduces unbounded fetch and response-body waits", async () => {
  for (const kind of ["headers", "body"]) {
    let release,
      settled = false;
    const c = client(original, async (_url, init) =>
      kind === "headers"
        ? new Promise((resolve) => {
            release = () => resolve(reply(init, []));
          })
        : new Response(
            new ReadableStream({
              start(controller) {
                release = () => {
                  controller.enqueue(
                    new TextEncoder().encode(
                      JSON.stringify({
                        jsonrpc: "2.0",
                        id: calls(init)[0].id,
                        result: []
                      })
                    )
                  );
                  controller.close();
                };
              }
            }),
            { headers: { "content-type": "application/json" } }
          )
    );
    const request = c.request(logs()).finally(() => {
      settled = true;
    });
    await pause(90);
    assert.equal(settled, false, kind);
    release();
    assert.deepEqual(await bounded(request), []);
  }
});

test("fixed header deadline rejects an abort-ignoring fetch and releases the Base slot", async () => {
  let dispatches = 0;
  const c = client(fixed, async (_url, init) => {
    dispatches++;
    return calls(init)[0].method === "eth_getLogs"
      ? new Promise(() => {})
      : reply(init);
  });
  const first = c.request(logs()),
    second = c.request({ method: "eth_chainId" });
  await bounded(assert.rejects(first, TimeoutError));
  assert.equal(await bounded(second), "0x2105");
  assert.equal(dispatches, 2);
});

test("fixed body deadline covers headers-first streams and cancels upstream reading", async () => {
  let cancellations = 0;
  const c = client(fixed, async (_url, init) =>
    calls(init)[0].method !== "eth_getLogs"
      ? reply(init)
      : new Response(
          new ReadableStream({
            cancel() {
              cancellations++;
            }
          }),
          { headers: { "content-type": "application/json" } }
        )
  );
  const first = c.request(logs()),
    second = c.request({ method: "eth_chainId" });
  await bounded(assert.rejects(first, TimeoutError));
  assert.equal(await bounded(second), "0x2105");
  assert.equal(cancellations, 1);
});

test("cancelled queued Base caller is removed without releasing another active lease", async () => {
  let release;
  const seen = [];
  const c = client(
    fixed,
    async (_url, init) => {
      const call = calls(init)[0];
      seen.push(call.params[0].fromBlock);
      if (seen.length === 1)
        return new Promise((resolve) => {
          release = () => resolve(reply(init, []));
        });
      return reply(init, []);
    },
    { timeout: 500 }
  );
  const first = c.request(logs(1));
  const controller = new AbortController(),
    reason = new DOMException("queued fixture", "AbortError");
  const second = c.request(logs(3), { signal: controller.signal });
  const refused = assert.rejects(second, (error) => error === reason);
  const third = c.request(logs(5));
  await pause(15);
  controller.abort(reason);
  await refused;
  assert.deepEqual(seen, ["0x1"]);
  release();
  await bounded(Promise.all([first, third]));
  assert.deepEqual(seen, ["0x1", "0x5"]);
});

test("active caller cancellation preserves its reason and permits the next FIFO caller", async () => {
  const controller = new AbortController(),
    reason = new DOMException("active fixture", "AbortError");
  let dispatches = 0;
  const c = client(
    fixed,
    async (_url, init) => {
      dispatches++;
      return calls(init)[0].method === "eth_getLogs"
        ? new Promise(() => {})
        : reply(init);
    },
    { timeout: 500 }
  );
  const first = c.request(logs(), { signal: controller.signal });
  const refused = assert.rejects(first, (error) => error === reason);
  const second = c.request({ method: "eth_chainId" });
  await pause(15);
  controller.abort(reason);
  await bounded(refused);
  assert.equal(await bounded(second), "0x2105");
  assert.equal(dispatches, 2);
});

test("non-Base source/evidence batches retain separate scheduler signals and exact policy headers", async () => {
  const seen = [],
    signal = new AbortController().signal;
  const fetchFn = async (_url, init) => {
    seen.push({
      count: calls(init).length,
      headers: new Headers(init.headers)
    });
    return reply(init);
  };
  const source = client(fixed, fetchFn, { chain: 1, timeout: 200 });
  const evidence = client(fixed, fetchFn, {
    chain: 1,
    workload: "unified_evidence",
    timeout: 200
  });
  await bounded(
    Promise.all([
      source.request({ method: "eth_chainId" }, { signal }),
      source.request({ method: "eth_blockNumber" }, { signal }),
      evidence.request({ method: "eth_chainId" }, { signal }),
      evidence.request({ method: "eth_blockNumber" }, { signal })
    ])
  );
  assert.equal(seen.length, 2);
  assert.deepEqual(
    seen.map((row) => row.count),
    [2, 2]
  );
  assert.deepEqual(
    new Set(seen.map((row) => row.headers.get("x-yunipals-rpc-workload"))),
    new Set(["unified_source", "unified_evidence"])
  );
  for (const row of seen) {
    assert.equal(
      row.headers.get("x-yunipals-unified-rpc-profile"),
      env.UNIFIED_RPC_PROFILE_ID
    );
    assert.equal(row.headers.has("x-yunipals-unified-rpc-permit"), false);
  }
});

test("factory timeout overrides configuration timeout and does not add client retries", async () => {
  let dispatches = 0;
  const c = client(
    fixed,
    async () => {
      dispatches++;
      return new Promise(() => {});
    },
    { timeout: 25, configuredTimeout: 500 }
  );
  const started = performance.now();
  await bounded(assert.rejects(c.request(logs()), TimeoutError));
  assert(performance.now() - started < 400);
  assert.equal(dispatches, 1);
  assert.throws(() => fixed.boundedRpcFetch(async () => new Response(), 0));
});

test("successful wire bytes/status/headers are unchanged and completed deadlines detach", async () => {
  let signal,
    cancelled = 0;
  const caller = new AbortController();
  const bytes = '{"jsonrpc":"2.0","id":1,"result":"✓"}';
  const fetchFn = fixed.boundedRpcFetch(async (_url, init) => {
    signal = init.signal;
    return new Response(
      new ReadableStream({
        start(controller) {
          const raw = new TextEncoder().encode(bytes);
          controller.enqueue(raw.slice(0, 5));
          controller.enqueue(raw.slice(5));
          controller.close();
        },
        cancel() {
          cancelled++;
        }
      }),
      {
        status: 201,
        statusText: "Created",
        headers: { "content-type": "application/json", "x-fixture": "same" }
      }
    );
  }, 25);
  const response = await fetchFn("http://fixture.invalid", {
    signal: caller.signal
  });
  assert.equal(await response.text(), bytes);
  assert.equal(response.status, 201);
  assert.equal(response.statusText, "Created");
  assert.equal(response.headers.get("x-fixture"), "same");
  caller.abort();
  await pause(60);
  assert.equal(signal.aborted, false);
  assert.equal(cancelled, 0);
});

test("consumer body cancellation clears the wire deadline and cancels the upstream stream", async () => {
  let signal,
    cancellations = 0;
  const fetchFn = fixed.boundedRpcFetch(async (_url, init) => {
    signal = init.signal;
    return new Response(
      new ReadableStream({
        cancel() {
          cancellations++;
        }
      })
    );
  }, 500);
  const response = await fetchFn("http://fixture.invalid");
  await response.body.cancel("fixture cancellation");
  assert.equal(signal.aborted, true);
  assert.equal(cancellations, 1);
});

test("consumer cancellation does not await an abort-ignoring upstream cancel callback", async () => {
  let cancellations = 0;
  const fetchFn = fixed.boundedRpcFetch(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancellations++;
            return new Promise(() => {});
          }
        })
      ),
    25
  );
  const response = await fetchFn("http://fixture.invalid");
  await bounded(response.body.cancel("stop fixture reading"));
  assert.equal(cancellations, 1);
});

test("late response after timed-out headers is cancelled without accepting its data", async () => {
  let resolve,
    cancelled = 0;
  const fetchFn = fixed.boundedRpcFetch(
    async () =>
      new Promise((done) => {
        resolve = done;
      }),
    25
  );
  await bounded(
    assert.rejects(fetchFn("http://fixture.invalid"), TimeoutError)
  );
  resolve(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
        }
      })
    )
  );
  await pause(5);
  assert.equal(cancelled, 1);
});

test("already cancelled init and Request signals refuse before any dispatch", async () => {
  let dispatches = 0;
  const c = new AbortController(),
    reason = new DOMException("already cancelled", "AbortError");
  c.abort(reason);
  const fetchFn = fixed.boundedRpcFetch(async () => {
    dispatches++;
    return new Response();
  }, 25);
  await assert.rejects(
    fetchFn("http://fixture.invalid", { signal: c.signal }),
    (error) => error === reason
  );
  await assert.rejects(
    fetchFn(new Request("http://fixture.invalid", { signal: c.signal })),
    (error) => error === reason
  );
  assert.equal(dispatches, 0);
});

test("existing viem body-size refusal remains fail-closed", async () => {
  const c = client(
    fixed,
    async () =>
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": String(10_485_761)
        }
      }),
    { chain: 1, workload: "unified_evidence", timeout: 25 }
  );
  await bounded(
    assert.rejects(
      c.request({ method: "eth_chainId" }),
      ResponseBodyTooLargeError
    )
  );
  await pause(40);
});

test("actual viem streaming size cap cannot hang on an abort-ignoring upstream cancel", async () => {
  let cancellations = 0,
    dispatches = 0;
  const c = client(
    fixed,
    async (_url, init) => {
      dispatches++;
      if (dispatches > 1) return reply(init);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(10_485_761));
          },
          cancel() {
            cancellations++;
            return new Promise(() => {});
          }
        }),
        { headers: { "content-type": "application/json" } }
      );
    },
    { timeout: 500 }
  );
  const first = c.request({ method: "eth_chainId" });
  const second = c.request({ method: "eth_blockNumber" });
  await bounded(assert.rejects(first, ResponseBodyTooLargeError));
  assert.equal(await bounded(second), "0x2105");
  assert.equal(cancellations, 1);
  assert.equal(dispatches, 2);
});

test("production AST delta is limited to the bounded fetch and its HTTP factory", () => {
  const parse = (text) =>
    ts.createSourceFile(
      "source.ts",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
  const source = parse(readFileSync(candidate, "utf8"));
  const transformed = ts.transform(source, [
    (context) => {
      const visit = (node) => {
        if (
          ts.isFunctionDeclaration(node) &&
          node.name?.text === "boundedRpcFetch"
        )
          return undefined;
        if (ts.isImportSpecifier(node) && node.name.text === "TimeoutError")
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
      return (file) => ts.visitNode(file, visit);
    }
  ]);
  const shape = (file) => {
    const visit = (node) => {
      const children = [];
      ts.forEachChild(node, (child) => {
        children.push(visit(child));
      });
      return {
        kind: node.kind,
        text:
          ts.isLiteralExpression(node) || ts.isIdentifier(node)
            ? node.text
            : undefined,
        isTypeOnly: node.isTypeOnly,
        children
      };
    };
    return visit(file);
  };
  assert.deepEqual(
    shape(parse(ts.createPrinter().printFile(transformed.transformed[0]))),
    shape(parse(readFileSync(baseline, "utf8")))
  );
  transformed.dispose();
  assert.equal(realFetchCalls, 0);
});

test("candidate passes the application strict TypeScript options at its real overlay location", () => {
  const app = root + "apps/yunipals-indexer/";
  const config = ts.readConfigFile(app + "tsconfig.json", ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, app);
  parsed.options.typeRoots = [app + "node_modules/@types"];
  const host = ts.createCompilerHost(parsed.options);
  const file = fileURLToPath(candidate);
  host.resolveModuleNames = (names, containingFile) =>
    names.map(
      (name) =>
        ts.resolveModuleName(
          name,
          containingFile === file
            ? app + "lib/unified/rpc-preflight.ts"
            : containingFile,
          parsed.options,
          host
        ).resolvedModule
    );
  const program = ts.createProgram([file], parsed.options, host);
  const errors = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === file);
  assert.equal(
    errors.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n"
    })
  );
});
