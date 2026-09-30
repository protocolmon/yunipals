export type ProjectionMode = "legacy" | "generation";

export function projectionMode(): ProjectionMode {
  const value = process.env.YUNIPALS_PROJECTION_MODE ?? "legacy";
  if (value !== "legacy" && value !== "generation") {
    throw new Error(`Invalid YUNIPALS_PROJECTION_MODE: ${value}`);
  }
  return value;
}
