import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Resvg } from "@resvg/resvg-js";
import { createElement } from "react";
import satori from "satori";
import sharp from "sharp";

import type { Preview } from "./resolve";

export type RenderAssets = { directory: string };
const fontCache = new Map<string, Promise<Buffer[]>>();
function fonts(directory: string) {
  let pending = fontCache.get(directory);
  if (!pending) {
    pending = Promise.all(
      ["inter-700.woff", "archivo-black-400.woff"].map((file) =>
        readFile(join(directory, "fonts", file))
      )
    );
    fontCache.set(directory, pending);
  }
  return pending;
}

export async function normalizeImage(bytes: Buffer) {
  // Do not render remotely supplied SVGs (including external references).
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216;
  const webp =
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
  if (!png && !jpeg && !webp) throw new Error("Unsupported artwork format.");
  return sharp(bytes, { limitInputPixels: 25_000_000, animated: false })
    .resize(900, 1000, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
}

export async function renderPreview(
  preview: Pick<Preview, "name" | "subtitle" | "traits" | "state">,
  artwork: Buffer,
  assets: RenderAssets
) {
  const [inter, archivo] = await fonts(assets.directory);
  const image = `data:image/png;base64,${(await normalizeImage(artwork)).toString("base64")}`;
  const el = createElement;
  const svg = await satori(
    el(
      "div",
      {
        style: {
          display: "flex",
          width: "100%",
          height: "100%",
          padding: 48,
          background:
            "linear-gradient(125deg, #ebe9ff 0%, #f6f2ff 48%, #dbf5e6 100%)",
          color: "#31234d",
          fontFamily: "Inter"
        }
      },
      el(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            width: 575,
            paddingRight: 30,
            justifyContent: "space-between"
          }
        },
        el(
          "div",
          {
            style: {
              display: "flex",
              fontFamily: "Archivo",
              fontSize: 28,
              letterSpacing: 2
            }
          },
          "YUNIPALS"
        ),
        el(
          "div",
          { style: { display: "flex", flexDirection: "column" } },
          el(
            "div",
            {
              style: {
                display: "flex",
                fontFamily: "Archivo",
                fontSize: preview.name.length > 48 ? 40 : 54,
                lineHeight: 1.12
              }
            },
            preview.name.slice(0, 100)
          ),
          el(
            "div",
            {
              style: {
                display: "flex",
                fontSize: 23,
                lineHeight: 1.4,
                marginTop: 24,
                color: "#5f5372"
              }
            },
            preview.subtitle.slice(0, 130)
          )
        ),
        el(
          "div",
          {
            style: { display: "flex", flexWrap: "wrap", gap: 10, fontSize: 17 }
          },
          ...preview.traits.slice(0, 3).map((trait) =>
            el(
              "div",
              {
                key: trait,
                style: {
                  display: "flex",
                  padding: "10px 14px",
                  borderRadius: 24,
                  backgroundColor: "#ffffffb8"
                }
              },
              trait.slice(0, 45)
            )
          )
        )
      ),
      el(
        "div",
        {
          style: {
            display: "flex",
            width: 480,
            height: 534,
            borderRadius: 36,
            padding: 18,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#ffffffb8",
            border: "2px solid #ffffff"
          }
        },
        el("img", {
          src: image,
          width: 444,
          height: 498,
          style: { objectFit: "contain", borderRadius: 22 }
        })
      )
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Inter", data: inter, weight: 700 },
        { name: "Archivo", data: archivo, weight: 400 }
      ]
    }
  );
  return Buffer.from(new Resvg(svg).render().asPng());
}
