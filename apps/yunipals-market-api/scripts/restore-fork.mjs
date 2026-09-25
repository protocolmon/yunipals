process.env.MARKET_TEST_RESTORE = "1";
process.env.MARKET_TEST_FORK_REPORT ??=
  "/tmp/yunipals-admitted-restore-fork.json";
process.env.MARKET_TEST_BROWSER_SCREENSHOT ??=
  "/tmp/yunipals-admitted-restore-mobile.png";
await import("./trading-fork.mjs");
