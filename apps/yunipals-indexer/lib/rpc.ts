export function baseRpcUrlOf(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.PONDER_RPC_URL_8453) return environment.PONDER_RPC_URL_8453;

  const ethereumUrl = environment.PONDER_RPC_URL_1;
  if (!ethereumUrl) throw new Error("PONDER_RPC_URL_1 is required");

  const url = new URL(ethereumUrl);
  if (url.hostname !== "eth-mainnet.g.alchemy.com") {
    throw new Error("PONDER_RPC_URL_8453 is required unless PONDER_RPC_URL_1 uses Alchemy");
  }
  url.hostname = "base-mainnet.g.alchemy.com";
  return url.toString();
}

export function polygonRpcUrlOf(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.PONDER_RPC_URL_137) return environment.PONDER_RPC_URL_137;

  const ethereumUrl = environment.PONDER_RPC_URL_1;
  if (!ethereumUrl) throw new Error("PONDER_RPC_URL_1 is required");

  const url = new URL(ethereumUrl);
  if (url.hostname !== "eth-mainnet.g.alchemy.com") {
    throw new Error("PONDER_RPC_URL_137 is required unless PONDER_RPC_URL_1 uses Alchemy");
  }
  url.hostname = "polygon-mainnet.g.alchemy.com";
  return url.toString();
}

export function bnbRpcUrlOf(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.PONDER_RPC_URL_56) return environment.PONDER_RPC_URL_56;

  const ethereumUrl = environment.PONDER_RPC_URL_1;
  if (!ethereumUrl) throw new Error("PONDER_RPC_URL_1 is required");

  const url = new URL(ethereumUrl);
  if (url.hostname !== "eth-mainnet.g.alchemy.com") {
    throw new Error("PONDER_RPC_URL_56 is required unless PONDER_RPC_URL_1 uses Alchemy");
  }
  url.hostname = "bnb-mainnet.g.alchemy.com";
  return url.toString();
}

export function bnbWsUrlOf(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.PONDER_WS_URL_56) return environment.PONDER_WS_URL_56;

  const url = new URL(bnbRpcUrlOf(environment));
  if (url.hostname !== "bnb-mainnet.g.alchemy.com") {
    throw new Error("PONDER_WS_URL_56 is required unless PONDER_RPC_URL_56 uses Alchemy");
  }
  url.protocol = "wss:";
  return url.toString();
}
