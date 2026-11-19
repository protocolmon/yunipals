import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  injectMetadata,
  metadataHtml,
  resolvePageMetadata,
  validTokenId
} from "./metadata";

const config = {
  siteOrigin: "https://example.test",
  exomonEnabled: true,
  staticRevision: "abc123"
};
const resolve = (path: string) =>
  resolvePageMetadata(new URL(path, config.siteOrigin), config);

test("collection variants have distinct images and stable canonical URLs", () => {
  const paths = [
    "/",
    "/?edition=tcg",
    "/?edition=airdrop",
    "/?collection=islands",
    "/?chain=solana"
  ];
  assert.equal(new Set(paths.map((p) => resolve(p).image)).size, paths.length);
  assert.equal(
    resolve("/?edition=tcg&sort=rarity-desc&utm_source=test").canonical,
    "https://example.test/?edition=tcg"
  );
  assert.equal(
    resolve("/?chain=base").canonical,
    "https://example.test/?edition=airdrop"
  );
  assert.equal(
    resolve("/leaderboard?chain=solana&other=x").canonical,
    "https://example.test/leaderboard?chain=solana"
  );
});

test("legacy aliases preserve navigation and point to the current routes", () => {
  assert.equal(resolve("/collection?edition=tcg").redirect, "/?edition=tcg");
  assert.equal(resolve("/collection/123").redirect, "/collection/ethereum/123");
  assert.equal(resolve("/portals/cards/123").redirect, "/grading/cards/123");
  assert.equal(
    resolve("/collection/base-islands/12").redirect,
    "/collection/base-islands-v2/12"
  );
});

test("detail URLs validate uint256 IDs, collections and Solana feature gating", () => {
  assert.equal(validTokenId((2n ** 256n - 1n).toString()), true);
  for (const id of ["-1", "01", "1.1", "abc", (2n ** 256n).toString()])
    assert.equal(validTokenId(id), false);
  assert.equal(resolve("/collection/ethereum/123").asset?.kind, "token");
  assert.equal(resolve("/grading/cards/123").asset?.kind, "portal-card");
  assert.equal(resolve("/grading/tokens/123").asset?.kind, "portal-token");
  assert.equal(resolve("/collection/unknown/123").status, 404);
  assert.equal(resolve("/collection/ethereum/01").status, 404);
  assert.equal(
    resolvePageMetadata(
      new URL(
        "/collection/solana/11111111111111111111111111111111",
        config.siteOrigin
      ),
      { ...config, exomonEnabled: false }
    ).status,
    404
  );
});

test("utility routes carry indexing policies and proposals use their own copy", () => {
  for (const path of [
    "/orders",
    "/orders/activity",
    "/grading/admin",
    "/boosters/setup/ypal",
    "/arena/anime/studio"
  ])
    assert.equal(resolve(path).robots, "noindex, follow");
  assert.match(resolve("/proposals/pack-opening").title, /new way to open/);
  assert.match(
    resolve("/proposals/pack-opening").image,
    /proposal-pack-opening\.abc123\.png/
  );
  assert.equal(resolve("/proposals/nonexistent").status, 404);
});

test("initial HTML has one escaped metadata block and preserves application assets", () => {
  const source = readFileSync(
    new URL("../../../index.html", import.meta.url),
    "utf8"
  );
  const meta = {
    ...resolve("/boosters"),
    title: 'A <dragon> & "friends"',
    description: "</title><script>bad()</script>"
  };
  const html = injectMetadata(source, meta);
  assert.match(html, /A &lt;dragon&gt; &amp; &quot;friends&quot;/);
  assert.doesNotMatch(html, /<script>bad/);
  assert.equal((html.match(/property="og:image"/g) || []).length, 1);
  assert.equal((html.match(/<title>/g) || []).length, 1);
  assert.match(html, /src="\/src\/main.tsx"/);
  assert.match(metadataHtml(meta), /content="1200"/);
  assert.throws(() => injectMetadata("<html></html>", meta), /markers/);
});
