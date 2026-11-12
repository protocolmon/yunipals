export class PortalUserError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "PortalUserError";
  }
}
