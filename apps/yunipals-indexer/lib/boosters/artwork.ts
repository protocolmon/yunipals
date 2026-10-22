import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Hono } from "hono";
import type { Pool } from "pg";
import { sqlIdentifier } from "../offchain/sql.js";
import { validateBoosterCatalog } from "../../../../packages/yunipals-market-core/src/boosterCatalog.js";

type Trait = { id: number; name: string };
type Catalog = {
  slug: string;
  catalogHash: string;
  artworkHash: string;
  metadataBaseURI: string;
  dictionary: {
    types: Trait[];
    colors: Trait[];
    horns: Trait[];
    glitters: Trait[];
  };
};
export type ArtworkTraits = {
  type: string;
  color: string;
  horn: string;
  glitter: string;
};
const validSlug = (value: string) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
const validRank = (value: string) => /^(0|[1-9][0-9]{0,8})$/.test(value);
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

export class BoosterArtworkStore {
  constructor(readonly directory: string) {}
  async catalog(slug: string): Promise<Catalog> {
    if (!validSlug(slug)) throw new Error("Invalid artwork catalog");
    const manifest = JSON.parse(
      await readFile(
        path.join(this.directory, "catalogs", slug, "manifest.json"),
        "utf8"
      )
    ) as Catalog;
    const d = manifest.dictionary;
    const result = validateBoosterCatalog({
      types: d.types.map((t) => t.id),
      colors: d.colors.map((t) => t.id),
      horns: d.horns.map((t) => t.id),
      glitters: d.glitters.map((t) => t.id),
      allowed: []
    });
    if (manifest.slug !== slug || result.catalogHash !== manifest.catalogHash)
      throw new Error("Invalid artwork catalog commitment");
    return manifest;
  }
  decode(catalog: Catalog, rank: number) {
    const d = catalog.dictionary;
    const categories = [d.types, d.colors, d.horns, d.glitters];
    const total = categories.reduce((n, items) => n * items.length, 1);
    if (!Number.isSafeInteger(rank) || rank < 0 || rank >= total)
      throw new Error("Invalid artwork variant");
    let rest = rank;
    const values = categories.map(() => ({ id: 0, name: "" }));
    for (let i = 3; i >= 0; i--) {
      values[i] = categories[i][rest % categories[i].length];
      rest = Math.floor(rest / categories[i].length);
    }
    return {
      traits: {
        type: values[0].name,
        color: values[1].name,
        horn: values[2].name,
        glitter: values[3].name
      },
      ids: values.map((t) => String(t.id))
    };
  }
  async metadata(slug: string, rank: number) {
    const catalog = await this.catalog(slug);
    const { traits } = this.decode(catalog, rank);
    try {
      const ready = JSON.parse(
        await readFile(
          path.join(
            this.directory,
            "catalogs",
            slug,
            "variants",
            `${rank}.json`
          ),
          "utf8"
        )
      );
      if (
        ready.yunipals?.variantId !== rank ||
        ready.yunipals?.catalogCommitment !== catalog.artworkHash ||
        ready.yunipals?.status !== "ready"
      )
        throw new Error("Invalid published artwork");
      return { ready: true, document: ready };
    } catch (error) {
      if (!missing(error)) throw error;
    }
    let status = "missing";
    try {
      const job = JSON.parse(
        await readFile(
          path.join(this.directory, "jobs", slug, `${rank}.json`),
          "utf8"
        )
      );
      status = job.status === "blocked" ? "blocked" : "queued";
    } catch (error) {
      if (!missing(error)) throw error;
    }
    return {
      ready: false,
      document: {
        name: traits.type,
        attributes: Object.entries(traits).map(([key, value]) => ({
          trait_type: key[0].toUpperCase() + key.slice(1),
          value
        })),
        yunipals: { version: 1, variantId: rank, status }
      }
    };
  }
  async enqueue(slug: string, rank: number) {
    const catalog = await this.catalog(slug);
    const { traits } = this.decode(catalog, rank);
    if ((await this.metadata(slug, rank)).ready) return false;
    const directory = path.join(this.directory, "jobs", slug);
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.${randomUUID()}.tmp`);
    await writeFile(
      temporary,
      JSON.stringify(
        {
          schemaVersion: 1,
          catalog: slug,
          catalogHash: catalog.catalogHash,
          variantId: rank,
          traits,
          status: "queued"
        },
        null,
        2
      )
    );
    try {
      await link(temporary, path.join(directory, `${rank}.json`));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    } finally {
      await unlink(temporary);
    }
  }
  async sync(pool: Pick<Pool, "query">, schemaName: string, slugs: string[]) {
    const schema = sqlIdentifier(schemaName);
    let queued = 0;
    for (const slug of slugs) {
      const catalog = await this.catalog(slug);
      const rows = await pool.query(
        `SELECT DISTINCT m.variant_id::text AS variant, m.monster_type::text AS type, m.color::text, m.horn::text, m.glitter::text FROM ${schema}.booster_monster m JOIN ${schema}.booster_type p ON p.id=m.type_key WHERE NOT m.burned AND p.catalog_hash=$1 AND p.metadata_base_uri=$2`,
        [catalog.catalogHash, catalog.metadataBaseURI]
      );
      for (const row of rows.rows) {
        const rank = Number(row.variant);
        const decoded = this.decode(catalog, rank);
        if (
          decoded.ids.some(
            (id, i) =>
              id !== String([row.type, row.color, row.horn, row.glitter][i])
          )
        )
          throw new Error("Indexed variant does not match artwork catalog");
        if (await this.enqueue(slug, rank)) queued++;
      }
    }
    return queued;
  }
}

export function registerBoosterArtworkRoutes(
  app: Hono,
  store: BoosterArtworkStore
) {
  app.get("/v1/boosters/art/:catalog/:file", async (c) => {
    const slug = c.req.param("catalog"),
      file = c.req.param("file");
    if (!validSlug(slug)) return c.json({ error: "invalid_catalog" }, 400);
    try {
      if (file === "manifest.json") {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
        return c.json(await store.catalog(slug));
      }
      const rank = file.replace(/\.json$/, "");
      if (!file.endsWith(".json") || !validRank(rank))
        return c.json({ error: "invalid_variant" }, 400);
      const result = await store.metadata(slug, Number(rank));
      c.header(
        "Cache-Control",
        result.ready ? "public, max-age=31536000, immutable" : "no-store"
      );
      if (!result.ready) c.header("Retry-After", "5");
      return c.json(result.document, result.ready ? 200 : 202);
    } catch (error) {
      if (missing(error))
        return c.json({ error: "artwork_catalog_not_found" }, 404);
      if (error instanceof Error && error.message === "Invalid artwork variant")
        return c.json({ error: "invalid_variant" }, 400);
      return c.json({ error: "artwork_unavailable" }, 503);
    }
  });
  app.get("/v1/boosters/art-assets/:file", async (c) => {
    const file = c.req.param("file");
    if (!/^[a-f0-9]{64}\.(png|svg)$/.test(file))
      return c.json({ error: "invalid_asset" }, 400);
    try {
      const data = await readFile(path.join(store.directory, "assets", file));
      if (
        createHash("sha256").update(data).digest("hex") !== file.split(".")[0]
      )
        throw new Error("Asset fingerprint mismatch");
      return new Response(data, {
        headers: {
          "Content-Type": file.endsWith(".svg") ? "image/svg+xml" : "image/png",
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'none'; sandbox"
        }
      });
    } catch (error) {
      return c.json(
        { error: "artwork_asset_unavailable" },
        missing(error) ? 404 : 503
      );
    }
  });
}
