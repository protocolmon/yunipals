export type AnalyticsRegion = "eu" | "us" | "india";
export type AnalyticsEnvironment = "production" | "preview" | "development";
export type AnalyticsRetention = {
  value: number;
  unit: "days" | "years";
};
export type AnalyticsConfig = {
  enabled: boolean;
  token: string;
  region: AnalyticsRegion;
  apiHost: string;
  environment: AnalyticsEnvironment;
  retention: AnalyticsRetention | null;
  privacyEmail: string;
};

export function analyticsConfigFromEnv(
  env: Record<string, unknown>
): AnalyticsConfig {
  const token = String(env.VITE_MIXPANEL_TOKEN ?? "").trim();
  const region = env.VITE_MIXPANEL_REGION;
  const deployment = env.VITE_ANALYTICS_ENVIRONMENT;
  const days = String(env.VITE_ANALYTICS_RETENTION_DAYS ?? "").trim();
  const years = String(env.VITE_ANALYTICS_RETENTION_YEARS ?? "").trim();
  const privacyEmail = String(env.VITE_PRIVACY_EMAIL ?? "").trim();
  const validRegion = region === "eu" || region === "us" || region === "india";
  const validEnvironment =
    deployment === "production" ||
    deployment === "preview" ||
    deployment === "development";
  const value = Number(years || days);
  const retention: AnalyticsRetention | null =
    Boolean(years) !== Boolean(days) &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= (years ? 100 : 36500)
      ? { value, unit: years ? "years" : "days" }
      : null;
  return {
    enabled:
      env.VITE_MIXPANEL_ENABLED === "true" &&
      env.MODE !== "fixtures" &&
      Boolean(token) &&
      validRegion &&
      validEnvironment &&
      retention !== null &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privacyEmail),
    token,
    region: validRegion ? region : "eu",
    apiHost:
      region === "us"
        ? "https://api.mixpanel.com"
        : region === "india"
          ? "https://api-in.mixpanel.com"
          : "https://api-eu.mixpanel.com",
    environment: validEnvironment ? deployment : "development",
    retention,
    privacyEmail
  };
}
