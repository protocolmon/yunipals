import { describe, expect, it } from "vitest";
import { baseRpcUrlOf, bnbRpcUrlOf, bnbWsUrlOf, polygonRpcUrlOf } from "../lib/rpc.js";

describe("baseRpcUrlOf", () => {
  it("prefers an explicit Base endpoint", () => {
    expect(baseRpcUrlOf({
      PONDER_RPC_URL_1: "https://eth-mainnet.g.alchemy.com/v2/ethereum-key",
      PONDER_RPC_URL_8453: "https://example.test/base"
    })).toBe("https://example.test/base");
  });

  it("derives Base without exposing or changing the Alchemy key", () => {
    expect(baseRpcUrlOf({
      PONDER_RPC_URL_1: "https://eth-mainnet.g.alchemy.com/v2/shared-secret"
    })).toBe("https://base-mainnet.g.alchemy.com/v2/shared-secret");
  });

  it("requires an explicit endpoint for other providers", () => {
    expect(() => baseRpcUrlOf({ PONDER_RPC_URL_1: "https://ethereum.example.test/rpc" }))
      .toThrow("PONDER_RPC_URL_8453 is required");
  });
});

describe("polygonRpcUrlOf", () => {
  it("prefers an explicit Polygon endpoint", () => {
    expect(polygonRpcUrlOf({
      PONDER_RPC_URL_1: "https://eth-mainnet.g.alchemy.com/v2/ethereum-key",
      PONDER_RPC_URL_137: "https://example.test/polygon"
    })).toBe("https://example.test/polygon");
  });

  it("derives Polygon without exposing or changing the Alchemy key", () => {
    expect(polygonRpcUrlOf({
      PONDER_RPC_URL_1: "https://eth-mainnet.g.alchemy.com/v2/shared-secret"
    })).toBe("https://polygon-mainnet.g.alchemy.com/v2/shared-secret");
  });

  it("requires an explicit endpoint for other providers", () => {
    expect(() => polygonRpcUrlOf({ PONDER_RPC_URL_1: "https://ethereum.example.test/rpc" }))
      .toThrow("PONDER_RPC_URL_137 is required");
  });
});

describe("BNB RPC endpoints", () => {
  it("prefers explicit HTTP and WebSocket endpoints", () => {
    const environment = {
      PONDER_RPC_URL_1: "https://eth-mainnet.g.alchemy.com/v2/ethereum-key",
      PONDER_RPC_URL_56: "https://example.test/bnb",
      PONDER_WS_URL_56: "wss://socket.example.test/bnb"
    };
    expect(bnbRpcUrlOf(environment)).toBe("https://example.test/bnb");
    expect(bnbWsUrlOf(environment)).toBe("wss://socket.example.test/bnb");
  });

  it("derives both transports from an Alchemy key", () => {
    const environment = { PONDER_RPC_URL_1: "https://eth-mainnet.g.alchemy.com/v2/shared-secret" };
    expect(bnbRpcUrlOf(environment)).toBe("https://bnb-mainnet.g.alchemy.com/v2/shared-secret");
    expect(bnbWsUrlOf(environment)).toBe("wss://bnb-mainnet.g.alchemy.com/v2/shared-secret");
  });

  it("requires explicit WebSocket configuration for other BNB providers", () => {
    expect(() => bnbWsUrlOf({
      PONDER_RPC_URL_1: "https://ethereum.example.test/rpc",
      PONDER_RPC_URL_56: "https://bnb.example.test/rpc"
    })).toThrow("PONDER_WS_URL_56 is required");
  });
});
