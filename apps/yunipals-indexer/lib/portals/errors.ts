export class PortalUserError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "PortalUserError";
  }
}

export class PortalSourceError extends Error {
  constructor(
    readonly code:
      | "source_identity_mismatch"
      | "source_definition_mismatch"
      | "source_unavailable"
      | "competition_unregistered",
    message: string
  ) {
    super(message);
    this.name = "PortalSourceError";
  }
}
