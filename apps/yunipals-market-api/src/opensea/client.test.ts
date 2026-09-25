import assert from "node:assert/strict";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import test from "node:test";
import { getAddress, zeroAddress } from "viem";

import { OpenSeaClient, OpenSeaError } from "@/opensea/client";
import {
  OpenSeaBudgetError,
  type OpenSeaRequestKind
} from "@/opensea/requestBudget";
import {
  acknowledgmentFixture,
  fixtureActor,
  publicationFixture
} from "@/opensea/fixtures/orders";
import {
  snapshotOpenSeaPublication,
  verifyOpenSeaAcknowledgment
} from "@/opensea/orders";

async function provider(
  handler: (req: IncomingMessage, res: ServerResponse) => void
) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
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

async function jsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString()) as Record<
    string,
    unknown
  >;
}

function send(res: ServerResponse, data: unknown) {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(data));
}

test("OpenSea HTTP paths and wire casing preserve exact identities on all three chains", async (t) => {
  const requests: {
    path: string;
    method: string;
    body?: Record<string, unknown>;
  }[] = [];
  let current = publicationFixture();
  const mock = await provider((req, res) => {
    void (async () => {
      assert.equal(req.headers["x-api-key"], "yunipals-fixture-only");
      const body = req.method === "POST" ? await jsonBody(req) : undefined;
      requests.push({ path: req.url!, method: req.method!, body });
      send(
        res,
        req.method === "GET"
          ? { order: acknowledgmentFixture(current) }
          : acknowledgmentFixture(current)
      );
    })().catch((error) => {
      res.destroy(error);
    });
  });
  t.after(() => mock.close());
  const client = new OpenSeaClient({
    apiKey: "yunipals-fixture-only",
    fixtureOrigin: mock.origin,
    authorizePublication: async () => {}
  });
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    for (const side of ["listing", "offer"] as const) {
      current = publicationFixture(chain, side);
      const result = await client.publish(current);
      assert.equal(result.state, "acknowledged");
      assert.equal(
        requests.at(-1)!.path,
        `/api/v2/orders/${chain}/seaport/${side === "listing" ? "listings" : "offers"}`
      );
      assert.deepEqual(
        requests.at(-1)!.body,
        snapshotOpenSeaPublication(current).body
      );
      const found = await client.lookup(current.summary);
      assert.equal(found!.orderHash, current.summary.orderHash);
      assert.equal(found!.order.counter, (2n ** 100n).toString());
      assert.equal(found!.order.salt, (2n ** 200n).toString());
      assert.equal(
        requests.at(-1)!.path,
        `/api/v2/orders/chain/${chain}/protocol/${current.summary.protocolAddress}/${current.summary.orderHash}`
      );
    }
  }
  assert.equal(requests.length, 12);
});

test("acceptance recomputes components and rejects altered NFT, fees, maker, chain and unsafe counters", () => {
  const candidate = publicationFixture();
  const changed = [
    (raw: ReturnType<typeof acknowledgmentFixture>) => {
      raw.chain = "base";
    },
    (raw: ReturnType<typeof acknowledgmentFixture>) => {
      raw.protocol_address = zeroAddress;
    },
    (raw: ReturnType<typeof acknowledgmentFixture>) => {
      raw.protocol_data.parameters.offerer = fixtureActor;
    },
    (raw: ReturnType<typeof acknowledgmentFixture>) => {
      raw.protocol_data.parameters.offer[0]!.identifierOrCriteria = "43";
    },
    (raw: ReturnType<typeof acknowledgmentFixture>) => {
      raw.protocol_data.parameters.consideration[1]!.recipient = fixtureActor;
    },
    (raw: ReturnType<typeof acknowledgmentFixture>) => {
      raw.protocol_data.parameters.consideration[0]!.startAmount = "1";
    },
    (raw: ReturnType<typeof acknowledgmentFixture>) => {
      raw.protocol_data.parameters.totalOriginalConsiderationItems = 1;
    },
    (raw: ReturnType<typeof acknowledgmentFixture>) => {
      Object.assign(raw.protocol_data.parameters, {
        counter: Number(2n ** 100n)
      });
    },
    (raw: ReturnType<typeof acknowledgmentFixture>) => {
      Object.assign(raw.protocol_data.parameters, { counter: -1 });
    },
    (raw: ReturnType<typeof acknowledgmentFixture>) => {
      Object.assign(raw.protocol_data.parameters, { start_time: "1700000000" });
    },
    (raw: ReturnType<typeof acknowledgmentFixture>) => {
      raw.remaining_quantity = 2;
    }
  ];
  for (const change of changed) {
    const raw = acknowledgmentFixture(candidate);
    change(raw);
    assert.throws(() =>
      verifyOpenSeaAcknowledgment(raw, candidate.summary, new Date())
    );
  }
  // Provider may omit/withhold the signature: retain the admitted signature and
  // use provider fulfillment authorization later, never overwrite it with 0x.
  assert.equal(
    verifyOpenSeaAcknowledgment(
      acknowledgmentFixture(candidate),
      candidate.summary,
      new Date()
    ).orderHash,
    candidate.summary.orderHash
  );
});

test("publication is disabled by default and snapshots survive caller/authorizer mutation", async (t) => {
  const bodies: unknown[] = [];
  const original = publicationFixture();
  const mock = await provider((req, res) => {
    void jsonBody(req).then((body) => {
      bodies.push(body);
      send(res, acknowledgmentFixture(original));
    });
  });
  t.after(() => mock.close());
  const options = {
    apiKey: "yunipals-fixture-only",
    fixtureOrigin: mock.origin
  };
  assert.deepEqual(await new OpenSeaClient(options).publish(original), {
    state: "not_sent",
    code: "publication_disabled"
  });
  assert.equal(bodies.length, 0);
  assert.deepEqual(
    await new OpenSeaClient({
      ...options,
      authorizePublication: async () => {
        throw new Error("private authorization details");
      }
    }).publish(original),
    { state: "not_sent", code: "publication_not_authorized" }
  );
  assert.equal(bodies.length, 0);
  const caller = structuredClone(original);
  const result = await new OpenSeaClient({
    ...options,
    authorizePublication: async (copy) => {
      caller.order.offerer = fixtureActor;
      copy.order.offerer = fixtureActor;
      copy.summary.asset.chain = "base";
    }
  }).publish(caller);
  assert.equal(result.state, "acknowledged");
  assert.deepEqual(bodies, [snapshotOpenSeaPublication(original).body]);
});

test("a dropped POST response remains uncertain and exact lookup recovers remote acceptance without retry", async (t) => {
  let posts = 0;
  let visible = false;
  const candidate = publicationFixture();
  const mock = await provider((req, res) => {
    if (req.method === "POST") {
      posts++;
      req.resume();
      res.destroy();
    } else if (visible) send(res, { order: acknowledgmentFixture(candidate) });
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  t.after(() => mock.close());
  const client = new OpenSeaClient({
    apiKey: "yunipals-fixture-only",
    fixtureOrigin: mock.origin,
    authorizePublication: async () => {}
  });
  assert.equal((await client.publish(candidate)).state, "indeterminate");
  assert.equal(await client.lookup(candidate.summary), null);
  visible = true;
  assert.equal(
    (await client.lookup(candidate.summary))!.orderHash,
    candidate.summary.orderHash
  );
  assert.equal(posts, 1);
});

test("HTTP rejection belongs to the attempt; conflicts, redirects and malformed success are uncertain", async (t) => {
  let status = 400;
  let calls = 0;
  const mock = await provider((_req, res) => {
    calls++;
    res.statusCode = status;
    res.setHeader("retry-after", "2");
    res.setHeader("location", "https://example.com/credential-sink");
    res.end("private error body and credential-like data");
  });
  t.after(() => mock.close());
  const client = new OpenSeaClient({
    apiKey: "yunipals-fixture-only",
    fixtureOrigin: mock.origin,
    authorizePublication: async () => {}
  });
  const statuses = [400, 401, 403, 404, 422, 429, 409, 500, 503, 302, 307, 200];
  for (status of statuses) {
    const result = await client.publish(publicationFixture());
    assert.equal(
      result.state,
      [400, 401, 403, 404, 422, 429].includes(status)
        ? "rejected"
        : "indeterminate"
    );
    assert.equal(JSON.stringify(result).includes("private"), false);
    if (status === 429) assert.equal(result.retryAfterMs, 2000);
  }
  assert.equal(calls, statuses.length);
});

test("redirects never forward credentials to a second server", async (t) => {
  let sinkCalls = 0;
  const sink = await provider((_req, res) => {
    sinkCalls++;
    res.end("{}");
  });
  const origin = await provider((_req, res) => {
    res.writeHead(307, { location: `${sink.origin}/sink` });
    res.end();
  });
  t.after(async () => {
    await origin.close();
    await sink.close();
  });
  const client = new OpenSeaClient({
    apiKey: "yunipals-fixture-only",
    fixtureOrigin: origin.origin,
    authorizePublication: async () => {}
  });
  assert.equal(
    (await client.publish(publicationFixture())).state,
    "indeterminate"
  );
  assert.equal(sinkCalls, 0);
});

test("timeouts include body reads, concurrency is bounded and oversized streams are rejected", async (t) => {
  let mode: "hang" | "large" | "ok" = "hang";
  let received!: () => void;
  const arrival = new Promise<void>((resolve) => {
    received = resolve;
  });
  const mock = await provider((_req, res) => {
    received();
    if (mode === "hang") {
      res.writeHead(200);
      res.write('{"pending":');
    } else if (mode === "large") {
      res.writeHead(200);
      res.end("a".repeat(2000));
    } else send(res, {});
  });
  t.after(() => mock.close());
  const client = new OpenSeaClient({
    apiKey: "yunipals-fixture-only",
    fixtureOrigin: mock.origin,
    timeoutMs: 150,
    maxConcurrent: 1,
    maxResponseBytes: 1000
  });
  const hanging = client.getCollection("yunipals");
  await arrival;
  await assert.rejects(
    client.getCollection("yunipals"),
    (error: unknown) =>
      error instanceof OpenSeaError && error.code === "provider_busy"
  );
  await assert.rejects(
    hanging,
    (error: unknown) =>
      error instanceof OpenSeaError && error.code === "provider_timeout"
  );
  mode = "large";
  await assert.rejects(
    client.getCollection("yunipals"),
    (error: unknown) =>
      error instanceof OpenSeaError &&
      error.code === "provider_response_too_large"
  );
  mode = "ok";
  assert.deepEqual(await client.getCollection("yunipals"), {});
});

test("provider origins, paths and fulfillment payloads are constrained", async (t) => {
  for (const fixtureOrigin of [
    "https://api.opensea.io",
    "http://localhost:8080",
    "http://127.0.0.1:8080/path",
    "http://u:p@127.0.0.1:8080",
    "http://127.0.0.1:8080?x=1"
  ]) {
    assert.throws(
      () =>
        new OpenSeaClient({ apiKey: "yunipals-fixture-only", fixtureOrigin })
    );
  }
  assert.throws(
    () =>
      new OpenSeaClient({
        apiKey: "real-secret",
        fixtureOrigin: "http://127.0.0.1:1234"
      })
  );
  assert.throws(() => new OpenSeaClient({ apiKey: "bad\r\nkey" }));
  const requests: { path: string; body: unknown }[] = [];
  const mock = await provider((req, res) => {
    void jsonBody(req).then((body) => {
      requests.push({ path: req.url!, body });
      send(res, { raw: "requires verification and simulation" });
    });
  });
  t.after(() => mock.close());
  const client = new OpenSeaClient({
    apiKey: "yunipals-fixture-only",
    fixtureOrigin: mock.origin
  });
  await assert.rejects(client.getCollection("../api-key"));
  for (const side of ["listing", "offer"] as const) {
    const { summary } = publicationFixture("polygon", side);
    await client.fulfillment(summary, fixtureActor);
    assert.deepEqual(requests.at(-1), {
      path: `/api/v2/${side === "listing" ? "listings" : "offers"}/fulfillment_data`,
      body: {
        [side]: {
          hash: summary.orderHash,
          chain: "polygon",
          protocol_address: summary.protocolAddress
        },
        fulfiller: { address: fixtureActor },
        units_to_fill: "1",
        include_optional_creator_fees: false,
        ...(side === "listing"
          ? { recipient: fixtureActor }
          : {
              consideration: {
                asset_contract_address: getAddress(
                  summary.asset.contractAddress
                ),
                token_id: "42"
              }
            })
      }
    });
  }
  assert.equal(requests.length, 2);
});

test("quota reservations precede HTTP and distinguish unsent publication from lost response accounting", async (t) => {
  let calls = 0;
  let deny = false;
  let failObservation = false;
  const kinds: OpenSeaRequestKind[] = [];
  const observed: number[] = [];
  const candidate = publicationFixture();
  const mock = await provider((_req, res) => {
    calls++;
    res.setHeader("x-ratelimit-remaining", "599");
    send(res, acknowledgmentFixture(candidate));
  });
  t.after(() => mock.close());
  const client = new OpenSeaClient({
    apiKey: "yunipals-fixture-only",
    fixtureOrigin: mock.origin,
    authorizePublication: async () => {},
    requestBudget: {
      async reserve(kind) {
        if (deny) throw new OpenSeaBudgetError(7200000);
        kinds.push(kind);
        return String(kinds.length);
      },
      async observe(_reservation, response) {
        assert.equal(response.headers.get("x-ratelimit-remaining"), "599");
        if (failObservation) throw new Error("private database address");
        observed.push(response.status);
      }
    }
  });
  await client.getCollection("yunipals");
  await client.fulfillment(candidate.summary, fixtureActor);
  assert.equal((await client.publish(candidate)).state, "acknowledged");
  assert.deepEqual(kinds, ["read", "fulfillment", "publication"]);
  assert.deepEqual(observed, [200, 200, 200]);
  deny = true;
  const unsent = await client.publish(candidate);
  assert.equal(unsent.state, "not_sent");
  assert.ok("retryAfterMs" in unsent);
  assert.equal(unsent.retryAfterMs, 7200000);
  assert.equal(calls, 3);
  deny = false;
  failObservation = true;
  const uncertain = await client.publish(candidate);
  assert.equal(uncertain.state, "indeterminate");
  assert.equal(JSON.stringify(uncertain).includes("private"), false);
  assert.equal(calls, 4);
  assert.throws(
    () => new OpenSeaClient({ apiKey: "valid-but-unbudgeted" }),
    /shared request budget/
  );
});

test("budget outages and cancellation during reservation never dispatch HTTP", async (t) => {
  let calls = 0;
  const mock = await provider((_req, res) => {
    calls++;
    send(res, {});
  });
  t.after(() => mock.close());
  let release!: () => void;
  let arrived!: () => void;
  const reserved = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let offline = true;
  const client = new OpenSeaClient({
    apiKey: "yunipals-fixture-only",
    fixtureOrigin: mock.origin,
    authorizePublication: async () => {},
    requestBudget: {
      async reserve() {
        if (offline) throw new Error("private database credential");
        arrived();
        await wait;
        return "charged";
      },
      async observe() {
        assert.fail("No response should exist");
      }
    }
  });
  const result = await client.publish(publicationFixture());
  assert.equal(result.state, "not_sent");
  assert.equal(JSON.stringify(result).includes("private"), false);
  offline = false;
  const abort = new AbortController();
  const request = client.getCollection("yunipals", abort.signal);
  await reserved;
  abort.abort();
  release();
  await assert.rejects(
    request,
    (error: unknown) =>
      error instanceof OpenSeaError && error.code === "provider_busy"
  );
  assert.equal(calls, 0);
});
