import { expect, it, vi } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import { renderHoloLayers } from "../lib/evolution/holo.js";
import { OpenAIPortalAI } from "../lib/portals/provider.js";
import { portalModels } from "@protopals/yunipals-market-core/portals";
import geometry from "./fixtures/evolution-holo.json";

const png = new Resvg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="purple"/></svg>'
)
  .render()
  .asPng();
function alpha(image: Uint8Array) {
  const pixels = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><image width="100" height="150" href="data:image/png;base64,${Buffer.from(image).toString("base64")}"/></svg>`
  ).render().pixels;
  return (x: number, y: number) => pixels[(y * 100 + x) * 4 + 3];
}
it("keeps foil off the frame and body, highlights on actual creature details, and cuts out the canvas", () => {
  const layers = renderHoloLayers(png, geometry);
  const background = alpha(layers.background),
    foreground = alpha(layers.foreground),
    stars = alpha(layers.stars),
    cutout = alpha(layers.cutout);
  expect(background(15, 50)).toBe(255);
  expect(background(50, 60)).toBe(0);
  expect(background(50, 15)).toBe(0);
  expect(foreground(50, 60)).toBe(255);
  expect(foreground(15, 50)).toBe(0);
  expect(stars(50, 60)).toBeGreaterThan(100);
  expect(stars(15, 50)).toBe(0);
  expect(stars(50, 80)).toBe(0);
  expect(cutout(0, 0)).toBe(0);
  expect(cutout(50, 15)).toBe(255);
  expect(() =>
    renderHoloLayers(png, {
      ...geometry,
      monster: [
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 }
        ]
      ]
    })
  ).toThrow("Implausible");
  expect(() =>
    renderHoloLayers(png, { ...geometry, card: "<script>" })
  ).toThrow();
  expect(() =>
    renderHoloLayers(png, {
      ...geometry,
      highlights: [{ x: Infinity, y: 50, radius: 1 }]
    })
  ).toThrow();
});
it("uses the portal model configuration and the exact generated image for bounded geometry", async () => {
  const request = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          model: portalModels.grading,
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: JSON.stringify(geometry) }]
            }
          ]
        })
      )
  );
  const ai = new OpenAIPortalAI("fixture-only", portalModels, request);
  expect((await ai.calibrateHolo(png)).geometry).toEqual(geometry);
  const body = JSON.parse(request.mock.calls[0][1]!.body as string);
  expect(body.model).toBe(portalModels.grading);
  expect(body.input[0].content[1].image_url).toBe(
    `data:image/png;base64,${png.toString("base64")}`
  );
  expect(body.text.format.strict).toBe(true);
  expect(body.instructions).toContain("untrusted");
});
