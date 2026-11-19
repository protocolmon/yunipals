import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { buildImages } from "../../scripts/social/build";
import { parseMonsterArtwork } from "../../src/lib/social/artwork";
import { resolvePageMetadata } from "../../src/lib/social/metadata";
import { socialConfig } from "./config";
import {
  assetUrl,
  createReader,
  PreviewError,
  publicAddress,
  type PreviewReader
} from "./fetch";
import { createSocialHandler } from "./handler";
import { normalizeImage, renderPreview } from "./render";
import { resolvePreview } from "./resolve";

const app = fileURLToPath(new URL("../../", import.meta.url));
const collection = `0x${"a".repeat(40)}`;
const grading = `0x${"b".repeat(40)}`;
const config = socialConfig({
  VITE_SITE_ORIGIN: "https://example.test",
  VITE_YUNIPALS_INDEXER_URL: "https://data.example.test/indexer",
  VITE_BOOSTER_MONSTERS: collection,
  VITE_BOOSTERS_ENABLED: "true",
  VITE_PORTALS_ENABLED: "true",
  VITE_PORTALS_GRADING_ADDRESS: grading,
  VITE_EXOMON_ENABLED: "true",
  VITE_SOCIAL_REVISION: "test"
});
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const original = {
  name: "Blue Unidragon #12",
  image: "https://data.example.test/original.webp",
  attributes: [{ trait_type: "Color", value: "Blue" }]
};
const slab = {
  ...original,
  name: "Prismane #12",
  image: "https://data.example.test/slab.png",
  yunipals: { version: "1" }
};
const path = `/monsters/${collection}/12`;
const metadata = (p = path) =>
  resolvePageMetadata(new URL(p, config.siteOrigin), config);
let directory: string;
let temporary: string;
let art: Buffer;
let template: string;

function reader(
  overrides: Record<string, unknown | Error> = {}
): PreviewReader {
  const values: Record<string, unknown | Error> = {
    [`/indexer/v1/boosters/monsters/${collection}/12`]: {
      item: {
        collection,
        tokenId: "12",
        metadataUri: "https://data.example.test/metadata.json",
        isOriginal: true
      }
    },
    "/metadata.json": original,
    "/indexer/v1/portals": {
      enabled: true,
      deployment: { chainId: 8453, cards: collection, grading }
    },
    "/indexer/v1/portals/cards/12.json": slab,
    ...overrides
  };
  return async (url, signal, image) => {
    signal.throwIfAborted();
    if (image) return art;
    const value = values[new URL(url).pathname];
    if (value instanceof Error) throw value;
    if (!value) throw new PreviewError(404, "Not found.");
    return json(value);
  };
}

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "yunipals-og-test-"));
  directory = await buildImages(app, temporary, config);
  art = await readFile(
    join(app, "public/images/bitcoin-unidragon-square.webp")
  );
  template = await readFile(join(app, "index.html"), "utf8");
});
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

test("address and artwork policies reject private networks and untrusted sources", async () => {
  assert.throws(
    () =>
      socialConfig({ VITE_SITE_ORIGIN: "https://name:secret@example.test" }),
    /origin/
  );
  assert.throws(
    () => socialConfig({ OG_ASSET_HOSTS: "*.example.test" }),
    /hostnames/
  );
  assert.throws(
    () =>
      socialConfig({
        VITE_YUNIPALS_INDEXER_URL: "https://name:secret@example.test"
      }),
    /HTTPS/
  );
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
    "2001:db8::1"
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  for (const uri of [
    "file:///etc/passwd",
    "https://evil.test/image.png",
    "https://user:pass@data.example.test/x",
    "http://data.example.test/x",
    "https://data.example.test:444/x"
  ])
    assert.equal(assetUrl(uri, config), null);
  assert.equal(assetUrl("ipfs://ipfs/abc", config), "https://ipfs.io/ipfs/abc");
  await assert.rejects(
    createReader(config)("https://127.0.0.1/x", AbortSignal.timeout(100)),
    /source/
  );
});

test("monster preview selects published graded art and falls back before grading", async () => {
  const ready = await resolvePreview(
    metadata(),
    config,
    reader(),
    AbortSignal.timeout(1000)
  );
  assert.equal(ready.name, "Prismane #12");
  assert.equal(ready.image, slab.image);
  const ungraded = await resolvePreview(
    metadata(),
    config,
    reader({
      "/indexer/v1/portals/cards/12.json": {
        ...slab,
        yunipals: { version: "0" }
      }
    }),
    AbortSignal.timeout(1000)
  );
  assert.equal(ungraded.image, original.image);
  assert.notEqual(ungraded.revision, ready.revision);
  const originalUnavailable = await resolvePreview(
    metadata(),
    config,
    reader({ "/metadata.json": new PreviewError(503, "Unavailable") }),
    AbortSignal.timeout(1000)
  );
  assert.equal(originalUnavailable.state, "ready");
  assert.equal(originalUnavailable.image, slab.image);
  assert.doesNotMatch(originalUnavailable.subtitle, /Original artwork/);
});

test("concurrent image requests share one public-data resolution and render", async () => {
  let resolutions = 0;
  const load = reader();
  const read: PreviewReader = async (...args) => {
    if (args[0].includes("/boosters/monsters/")) resolutions++;
    return load(...args);
  };
  const handler = createSocialHandler({
    config,
    directory,
    html: template,
    read
  });
  const url = new URL(metadata().image);
  const [left, right] = await Promise.all([
    handler(new Request(url)),
    handler(new Request(url))
  ]);
  assert.equal(resolutions, 1);
  assert.deepEqual(await left.arrayBuffer(), await right.arrayBuffer());
});

test("deployment mismatch, grading outage and pending art never invent a grade", async () => {
  const mismatch = await resolvePreview(
    metadata(),
    config,
    reader({
      "/indexer/v1/portals": {
        enabled: true,
        deployment: { chainId: 1, cards: collection, grading }
      }
    }),
    AbortSignal.timeout(1000)
  );
  assert.equal(mismatch.image, original.image);
  const fallback = await resolvePreview(
    metadata(),
    config,
    reader({ "/indexer/v1/portals": new PreviewError(503, "Unavailable") }),
    AbortSignal.timeout(1000)
  );
  assert.equal(fallback.state, "fallback");
  assert.match(fallback.subtitle, /Original artwork/);
  const pending = await resolvePreview(
    metadata(),
    { ...config, portalsEnabled: false },
    reader({ "/metadata.json": { yunipals: { status: "queued" } } }),
    AbortSignal.timeout(1000)
  );
  assert.equal(pending.state, "pending");
  assert.equal(pending.image, null);
  assert.throws(() => parseMonsterArtwork(null, (v) => v));
});

test("OG HTML and image endpoints expose a complete public sharing flow", async () => {
  const handler = createSocialHandler({
    config,
    directory,
    html: template,
    read: reader()
  });
  const page = await handler(new Request(new URL(path, config.siteOrigin)));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Prismane #12/);
  const image = /property="og:image" content="([^"]+)"/
    .exec(html)![1]
    .replaceAll("&amp;", "&");
  const png = await handler(new Request(image));
  assert.equal(png.status, 200);
  assert.equal(png.headers.get("Content-Type"), "image/png");
  assert.match(png.headers.get("CDN-Cache-Control")!, /max-age=300/);
  const dimensions = await sharp(
    Buffer.from(await png.arrayBuffer())
  ).metadata();
  assert.equal(dimensions.width, 1200);
  assert.equal(dimensions.height, 630);
  const head = await handler(new Request(image, { method: "HEAD" }));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(head.headers.get("ETag"), png.headers.get("ETag"));
  const cached = await handler(
    new Request(image, {
      headers: { "If-None-Match": png.headers.get("ETag")! }
    })
  );
  assert.equal(cached.status, 304);
  const rewrite = await handler(
    new Request(
      `${config.siteOrigin}/api/social-page?__socialPath=${encodeURIComponent(path)}`
    )
  );
  assert.match(await rewrite.text(), /Prismane #12/);
});

test("invalid assets return 404 while transient failures get uncached fallback images", async () => {
  const handler = createSocialHandler({
    config,
    directory,
    html: template,
    read: reader()
  });
  assert.equal(
    (
      await handler(
        new Request(`${config.siteOrigin}/api/og/token/ethereum/-1.png`)
      )
    ).status,
    404
  );
  assert.equal(
    (
      await handler(
        new Request(
          `${config.siteOrigin}/api/og/monster/0x${"c".repeat(40)}/12.png`
        )
      )
    ).status,
    404
  );
  assert.equal(
    (
      await handler(
        new Request(`${config.siteOrigin}/api/og/monster/${collection}/99.png`)
      )
    ).status,
    404
  );
  const failing = createSocialHandler({
    config,
    directory,
    html: template,
    read: async () => {
      throw new PreviewError(503, "Outage");
    }
  });
  const image = await failing(
    new Request(`${config.siteOrigin}/api/og/monster/${collection}/12.png`)
  );
  assert.equal(image.headers.get("Content-Type"), "image/png");
  assert.match(image.headers.get("CDN-Cache-Control")!, /max-age=0/);
  const page = await failing(new Request(new URL(path, config.siteOrigin)));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /utility\.test\.png/);
  assert.equal(
    (await handler(new Request(config.siteOrigin, { method: "POST" }))).status,
    405
  );
});

test("original collection, Islands, Exomon and portal NFTs use their public adapters", async () => {
  const cases = [
    [
      "/collection/base/12",
      "/indexer/v1/tokens/base/12",
      { token: { token_id: "12", ...original } }
    ],
    [
      "/collection/base-islands-v2/12",
      "/indexer/v2/collections/base-islands-v2/tokens/12",
      { token: { tokenId: "12", metadata: original } }
    ],
    [
      "/collection/solana/11111111111111111111111111111111",
      "/indexer/v1/tokens/solana/11111111111111111111111111111111",
      { token: { ...original } }
    ],
    [
      "/grading/tokens/12",
      "/indexer/v1/portals/tokens/12",
      {
        token: {
          id: "12",
          name: "Rainbow Portal",
          imageURI: original.image,
          retired: true
        }
      }
    ]
  ] as const;
  for (const [path, api, data] of cases) {
    const preview = await resolvePreview(
      metadata(path),
      config,
      reader({ [api]: data }),
      AbortSignal.timeout(1000)
    );
    assert.equal(preview.state, "ready", path);
  }
});

test("raster rendering is deterministic, normalizes WebP and rejects unsafe formats", async () => {
  const preview = {
    name: "A very long Yunipal name with a particularly unusual horn #123456789",
    subtitle: "TCG collection · Artwork example",
    traits: ["Color: Blue"],
    state: "ready" as const
  };
  const first = await renderPreview(preview, art, { directory });
  assert.deepEqual(first, await renderPreview(preview, art, { directory }));
  assert.notDeepEqual(
    first,
    await renderPreview({ ...preview, name: "Different card" }, art, {
      directory
    })
  );
  assert.equal(
    (await sharp(await normalizeImage(art)).metadata()).format,
    "png"
  );
  await assert.rejects(
    normalizeImage(Buffer.from('<svg><image href="https://evil.test"/></svg>')),
    /Unsupported/
  );
});
