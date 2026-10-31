import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { analyticsCountryHandler } from "./analytics-country.mjs";

test("country endpoint returns only a hosting country code and prevents shared caching", async () => {
  const server = createServer(analyticsCountryHandler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/analytics-country`;
  try {
    for (const country of ["DE", "FR", "XX", "ZZ", "de", "secret", ""]) {
      const response = await fetch(url, {
        headers: {
          "x-vercel-ip-country": country,
          "x-forwarded-for": "203.0.113.12",
          "x-vercel-ip-city": "private",
          "x-vercel-ip-latitude": "52.5"
        }
      });
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("cache-control"),
        "private, no-store, max-age=0"
      );
      assert.deepEqual(await response.json(), {
        country: ["DE", "FR"].includes(country) ? country : null
      });
    }
    const post = await fetch(url, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
