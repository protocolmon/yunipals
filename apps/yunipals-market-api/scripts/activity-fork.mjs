process.env.MARKET_TEST_WORKER = "1";
process.env.MARKET_TEST_ACTIVITY = "1";
process.env.MARKET_TEST_FORK_REPORT ??=
  "/tmp/yunipals-activity-fork-report.json";
await import("./admission-fork.mjs");
