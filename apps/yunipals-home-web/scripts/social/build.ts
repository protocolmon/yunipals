import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { proposalPreviews } from "../../src/lib/social/proposals";
import {
  socialConfig,
  type PreviewConfig,
  type PreviewConfigOptions
} from "../../server/social/config";
import { renderPreview } from "../../server/social/render";
import {
  escapeHtml,
  injectMetadata,
  resolvePageMetadata,
  socialCards,
  staticImagePath,
  staticPages,
  type SocialCard
} from "../../src/lib/social/metadata";

export async function buildSettings(
  app: string,
  env: Record<string, string | undefined>,
  options: PreviewConfigOptions = {}
) {
  // Any renderer, font package or input-art change invalidates all static cards.
  const hash = createHash("sha256");
  for (const file of [
    "src/lib/social/metadata.ts",
    "server/social/render.ts",
    "server/social/CollectiblePreview.ts",
    "server/social/PreviewBrand.ts",
    "public/images/brandkit/yunipals-logo.png",
    "src/lib/social/proposals.ts",
    "package.json",
    ...Object.values(proposalPreviews).map((p) => p.artwork),
    ...Object.values(socialCards).map((card) => `public${card[2]}`)
  ])
    hash.update(await readFile(join(app, file)));
  const config = socialConfig(
    {
      ...env,
      VITE_SOCIAL_REVISION: hash.digest("hex").slice(0, 12)
    },
    options
  );
  return config;
}

export async function buildImages(
  app: string,
  output: string,
  config: PreviewConfig
) {
  const directory = join(output, ".social/assets");
  await mkdir(join(directory, "fonts"), { recursive: true });
  await cp(
    join(app, "public/images/brandkit/yunipals-logo.png"),
    join(directory, "logo.png")
  );
  for (const [family, weight] of [
    ["inter", "700"],
    ["archivo-black", "400"]
  ]) {
    await cp(
      join(
        app,
        `node_modules/@fontsource/${family}/files/${family}-latin-${weight}-normal.woff`
      ),
      join(directory, `fonts/${family}-${weight}.woff`)
    );
    await cp(
      join(app, `node_modules/@fontsource/${family}/LICENSE`),
      join(directory, `fonts/${family}-LICENSE`)
    );
  }
  const fallback = await readFile(
    join(app, "public/images/bitcoin-unidragon-square.webp")
  );
  const { normalizeImage } = await import("../../server/social/render");
  await writeFile(
    join(directory, "fallback.png"),
    await normalizeImage(fallback)
  );
  const unavailable = await renderPreview(
    {
      name: "A little magic is on its way",
      subtitle: "Yunipals · Preview temporarily unavailable",
      traits: [],
      state: "fallback"
    },
    fallback,
    { directory }
  );
  await writeFile(join(directory, "unavailable.png"), unavailable);
  const images = join(output, "images/og");
  await mkdir(images, { recursive: true });
  const gallery: string[] = [];
  for (const key of Object.keys(socialCards) as SocialCard[]) {
    const [name, subtitle, image] = socialCards[key];
    const png = await renderPreview(
      { name, subtitle, traits: [], state: "ready" },
      await readFile(join(app, `public${image}`)),
      { directory }
    );
    const imagePath = staticImagePath(key, config);
    await writeFile(join(output, imagePath.slice(1)), png);
    gallery.push(
      `<figure><img width="600" height="315" src="..${imagePath}" alt="${escapeHtml(subtitle)}"><figcaption>${key}</figcaption></figure>`
    );
  }
  for (const [slug, proposal] of Object.entries(proposalPreviews)) {
    const path = staticImagePath("proposals", config, `proposal-${slug}`);
    await writeFile(
      join(output, path.slice(1)),
      await renderPreview(
        {
          name: proposal.title,
          subtitle: "Community proposal · Design preview",
          traits: [],
          state: "ready"
        },
        await readFile(join(app, proposal.artwork)),
        { directory }
      )
    );
    gallery.push(
      `<figure><img width="600" height="315" src="..${path}" alt="${escapeHtml(proposal.title)}"><figcaption>${slug}</figcaption></figure>`
    );
  }
  await writeFile(
    join(output, ".social/gallery.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Yunipals preview gallery</title><body>${gallery.join("\n")}</body></html>`
  );
  return directory;
}

export async function buildPages(
  output: string,
  config: PreviewConfig,
  template: string
) {
  for (const path of staticPages) {
    const destination =
      path === "/"
        ? join(output, "index.html")
        : join(output, path.slice(1), "index.html");
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(
      destination,
      injectMetadata(
        template,
        resolvePageMetadata(new URL(path, config.siteOrigin), config)
      )
    );
  }
  await mkdir(join(output, ".social"), { recursive: true });
  await writeFile(join(output, ".social/social-template.html"), template);
  await writeFile(
    join(output, ".social/social-config.json"),
    JSON.stringify(config)
  );
  const sitemap = [
    ...staticPages,
    "/?edition=tcg",
    "/?edition=airdrop",
    "/?collection=islands",
    ...(config.exomonEnabled
      ? ["/?chain=solana", "/leaderboard?chain=solana"]
      : [])
  ].filter(
    (path) =>
      resolvePageMetadata(new URL(path, config.siteOrigin), config).robots ===
      "index, follow"
  );
  await writeFile(
    join(output, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemap.map((path) => `<url><loc>${escapeHtml(new URL(path, config.siteOrigin).href)}</loc></url>`).join("")}</urlset>`
  );
  await writeFile(
    join(output, "robots.txt"),
    `User-agent: *\nAllow: /\nDisallow: /.social/\nSitemap: ${config.siteOrigin}/sitemap.xml\n`
  );
}
