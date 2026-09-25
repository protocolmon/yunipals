process.env.MARKET_TEST_WORKER = "1";
process.env.MARKET_TEST_FORK_REPORT ??= "/tmp/yunipals-worker-fork-report.json";
await import("./admission-fork.mjs");
