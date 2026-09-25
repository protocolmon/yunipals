import { MarketApiError } from "@/lib/marketplace/marketApiError";

export function tradeErrorMessage(error: unknown) {
  if (error instanceof MarketApiError) return error.message;
  if (
    error instanceof Error &&
    /user rejected|user denied|rejected the request/i.test(error.message)
  )
    return "Request cancelled in your wallet.";
  if (error instanceof Error && error.name === "TimeoutError")
    return "Preparing the trade took too long. Please try again.";
  // Library errors can contain private provider payloads. Only display our
  // deliberately authored plain Error messages and safe API messages.
  if (error instanceof Error && error.name === "Error") return error.message;
  return "The trade could not be prepared. Please try again.";
}
