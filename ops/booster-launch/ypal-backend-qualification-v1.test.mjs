import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  copyFile,
  symlink,
  rm,
  readFile,
  writeFile
} from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  publicDeploymentClient,
  PUBLIC_POLICY,
  qualifyNow
} from "./ypal-backend-qualification-v1.mjs";

test("fixed public Base actual viem reads have no profile/credential headers, redirects or retries", async () => {
  const requests = [];
  const { client, requestCount } = publicDeploymentClient(async (url, init) => {
    requests.push({
      url: new URL(typeof url === "string" ? url : url.url).href,
      method: init.method,
      headers: Object.fromEntries(new Headers(init.headers)),
      redirect: init.redirect,
      body: JSON.parse(init.body)
    });
    return Response.json({
      jsonrpc: "2.0",
      id: requests.at(-1).body.id,
      result: "0x2105"
    });
  });
  assert.equal(await client.getChainId(), 8453);
  assert.equal(requestCount(), 1);
  assert.equal(requests[0].url, "https://mainnet.base.org/");
  assert.equal(requests[0].redirect, "error");
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(
    requests[0].headers["x-yunipals-unified-rpc-profile"],
    undefined
  );
  await assert.rejects(
    client.request({ method: "eth_sendRawTransaction", params: ["0x01"] })
  );
  assert.equal(requests.length, 1);
});
test("160-call cap is enforced before a 161st fetch entry", async () => {
  let entries = 0;
  const { client, requestCount } = publicDeploymentClient(
    async (_url, init) => {
      entries++;
      return Response.json({
        jsonrpc: "2.0",
        id: JSON.parse(init.body).id,
        result: "0x2105"
      });
    }
  );
  for (let i = 0; i < 160; i++)
    await client.request({ method: "eth_chainId", params: [] });
  await assert.rejects(client.request({ method: "eth_chainId", params: [] }));
  assert.equal(entries, 160);
  assert.equal(requestCount(), 160);
});
test("180-second cap refuses before provider request, with no implicit retry", async () => {
  let time = 1000,
    entries = 0;
  const { client } = publicDeploymentClient(
    async () => {
      entries++;
      throw Error("must not fetch");
    },
    () => time
  );
  time += 180000;
  await assert.rejects(client.request({ method: "eth_chainId", params: [] }));
  assert.equal(entries, 0);
});
test("public read policy explicitly supplies no indexing or financial authority", () => {
  assert.equal(PUBLIC_POLICY.financialProfileUsed, false);
  assert.equal(PUBLIC_POLICY.sourceAdmissionQualified, false);
  assert.equal(PUBLIC_POLICY.paidCalls, 0);
  assert.equal(PUBLIC_POLICY.maximumRequests, 160);
  assert.equal(PUBLIC_POLICY.maximumSeconds, 180);
  assert.equal(typeof qualifyNow, "function");
});

test("minimal staged public source closure resolves existing viem and exact ABI without a full checkout", async () => {
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const stage = await mkdtemp(
    resolve(repo, "ops/booster-launch/.ypal-stage-test-")
  );
  try {
    for (const relative of [
      "ops/booster-launch/ypal-backend-prepare-v1.mjs",
      "ops/booster-launch/ypal-backend-qualification-v1.mjs",
      "packages/yunipals-market-core/src/boosterAbi.ts"
    ]) {
      const target = resolve(stage, relative);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolve(repo, relative), target);
    }
    await symlink(
      resolve(repo, "apps/yunipals-home-web/node_modules"),
      resolve(stage, "node_modules"),
      "dir"
    );
    await writeFile(resolve(stage, "package.json"), '{"type":"module"}\n');
    const backend = await import(
      pathToFileURL(
        resolve(stage, "ops/booster-launch/ypal-backend-prepare-v1.mjs")
      )
    );
    const qualifier = await import(
      pathToFileURL(
        resolve(stage, "ops/booster-launch/ypal-backend-qualification-v1.mjs")
      )
    );
    const input = await backend.inputs(
      await readFile(
        resolve(
          repo,
          "apps/yunipals-home-web/public/boosters/ypal-fresh-launch-v1.json"
        )
      )
    );
    assert.equal(input.bundle.chainId, 8453);
    assert.equal(typeof qualifier.qualifyNow, "function");
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});
