export class MarketApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(
      status === 409
        ? "This order changed. Refresh it before continuing."
        : status === 429
          ? "Trading requests are busy. Try again shortly."
          : "Trading data is temporarily unavailable. Please try again."
    );
    this.name = "MarketApiError";
    this.status = status;
  }
}
