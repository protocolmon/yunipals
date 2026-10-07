export function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/([?&]api-key=)[^&\s'"\]]+/gi, "$1<redacted>")
    .replace(/https?:\/\/[^\s'"\]]+\/v2\/[^\s'"\]]+/gi, "<redacted-rpc-url>")
    .replace(/wss?:\/\/[^\s'"\]]+\/v2\/[^\s'"\]]+/gi, "<redacted-rpc-url>");
}
