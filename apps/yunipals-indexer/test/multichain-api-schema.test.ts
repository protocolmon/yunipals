import { describe, expect, it } from "vitest";
import { collections } from "../lib/constants.js";
import { openApiDocument } from "../lib/api/openapi.js";

describe("multi-chain configuration", () => {
  it("defines stable collection identities", () => {
    expect(collections.ethereum).toMatchObject({ chainId: 1, deploymentBlock: 12_134_519 });
    expect(collections.base).toMatchObject({
      chainId: 8_453,
      address: "0x98433df878e8c898cb907345c3a7756e5f72240f",
      deploymentBlock: 22_224_075
    });
    expect(collections.polygon).toMatchObject({
      chainId: 137,
      address: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
      deploymentBlock: 21_814_218
    });
    expect(collections.bnb).toMatchObject({
      chainId: 56,
      ensCoinType: 2_147_483_704,
      address: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
      deploymentBlock: 7_579_197
    });
  });

  it("documents unified token queries and chain-qualified details", () => {
    const paths = openApiDocument.paths as Record<string, any>;
    const tokenParameters = paths["/v1/tokens"].get.parameters;
    expect(tokenParameters.find((parameter: any) => parameter.name === "chain")?.schema.items.enum)
      .toEqual(["ethereum", "base", "polygon", "bnb"]);
    expect(tokenParameters.find((parameter: any) => parameter.name === "chain")).toMatchObject({ style: "form", explode: true });
    expect(tokenParameters.find((parameter: any) => parameter.name === "cursor")?.schema.pattern)
      .toBeUndefined();
    expect(paths["/v1/tokens/{chain}/{tokenId}"]).toBeDefined();
    expect(paths["/v1/collections"]).toBeDefined();
    expect(tokenParameters.find((parameter: any) => parameter.name === "rarityCappedMin")).toBeDefined();
    expect(tokenParameters.find((parameter: any) => parameter.name === "rarityCappedMax")).toBeDefined();
    expect(tokenParameters.find((parameter: any) => parameter.name === "sort")?.schema.enum)
      .toContain("rarity-capped-desc");
    const tokenSummary = (openApiDocument.components.schemas as Record<string, any>).TokenSummary;
    expect(tokenSummary.properties.rarityPoints).toBeDefined();
    expect(tokenSummary.properties.rarityPointsCapped).toBeDefined();
  });

  it("documents signed visibility and owner management modes", () => {
    const paths = openApiDocument.paths as Record<string, any>;
    expect(paths["/v1/tokens/{chain}/{tokenId}/visibility/signing-data"]?.get).toBeDefined();
    expect(paths["/v1/tokens/{chain}/{tokenId}/visibility"]?.put).toBeDefined();
    const ownerParameters = paths["/v1/owners/{address}/tokens"].get.parameters;
    expect(ownerParameters.find((parameter: any) => parameter.name === "visibility")?.schema.enum)
      .toEqual(["visible", "hidden", "all"]);
  });
});
