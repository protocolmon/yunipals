export function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const withoutConfiguredUrl = process.env.BNB_RPC_URL
    ? message.replaceAll(process.env.BNB_RPC_URL, "<redacted-rpc-url>")
    : message;
  return withoutConfiguredUrl
    .replace(/https?:\/\/[^\s'"\]]+\/v2\/[^\s'"\]]+/gi, "<redacted-rpc-url>")
    .replace(/wss?:\/\/[^\s'"\]]+\/v2\/[^\s'"\]]+/gi, "<redacted-rpc-url>");
}
