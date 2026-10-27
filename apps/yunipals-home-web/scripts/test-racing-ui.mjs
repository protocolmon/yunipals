import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5180" },
    playwright: { type: "string" },
    chromium: { type: "string" },
    output: { type: "string", default: "/tmp/yunipals-llm-ui" }
  }
});
const app = new URL(values.url);
if (
  app.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(app.hostname)
)
  throw new Error("Use a local race studio server.");
if (!values.playwright)
  throw new Error("Pass an installed Playwright module with --playwright.");
const { records } = JSON.parse(
  await readFile(
    new URL(
      "../../../docs/islands/pilot-v2/llm-race-examples.json",
      import.meta.url
    ),
    "utf8"
  )
);
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  acceptDownloads: true
});
const page = await context.newPage();
const report = {
  tests: [],
  errors: [],
  blockedRequests: [],
  screenshots: [],
  liveProviderTested: false
};
page.on("pageerror", (error) => report.errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error")
    report.errors.push({
      message: message.text(),
      location: message.location()
    });
});
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin === app.origin) return route.continue();
  // Fixture mode embeds port 5177. A preview on another port still serves
  // these fixtures; forward those reads to the selected local preview.
  if (
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.pathname.startsWith("/__fixtures/")
  ) {
    const response = await route.fetch({
      url: `${app.origin}${url.pathname}${url.search}`
    });
    return route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "access-control-allow-origin": app.origin
      }
    });
  }
  if (url.hostname === "fonts.googleapis.com")
    return route.fulfill({ status: 200, contentType: "text/css", body: "" });
  // Keep home-route navigation local. Island artwork stays unstubbed.
  if (route.request().resourceType() === "image")
    return route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#ddd"/></svg>'
    });
  report.blockedRequests.push({
    url: url.href,
    type: route.request().resourceType()
  });
  return route.abort();
});
await mkdir(values.output, { recursive: true });
async function download(button) {
  const ready = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const result = await ready;
  return JSON.parse(await readFile(await result.path(), "utf8"));
}
const choose = (name) =>
  page
    .getByRole("region", { name: "Choose an island" })
    .getByRole("button", { name: new RegExp(name) })
    .click();
try {
  await page.goto(`${app.origin}/race-lab`);
  await page.getByRole("heading", { name: "YOUR PLANS. ONE RACE." }).waitFor();
  await page
    .getByText("Live generation needs a server connection.", { exact: false })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Generate full race" }).isDisabled(),
    true
  );
  assert.equal(await page.locator("vite-error-overlay").count(), 0);
  assert.equal(
    await page.getByRole("textbox", { name: /'s strategy/ }).count(),
    3
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll("main img")].every(
      (img) => img.complete && img.naturalWidth > 0
    )
  );
  report.tests.push(
    "Studio loads with all island art, three freeform strategies, and generation disabled without credentials"
  );

  for (const record of records) {
    const name =
      record.prompt.user && JSON.parse(record.prompt.user).island.name;
    await choose(name);
    await page
      .getByRole("button", { name: "Load example", exact: true })
      .click();
    await page
      .getByText("Stored chat-generated example", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Next beat" }).click();
    await page
      .getByText(`Beat 2/${record.outcome.beats.length}`, { exact: false })
      .waitFor();
    await page.getByRole("button", { name: "Previous beat" }).click();
    await page
      .getByRole("button", { name: "Finish order", exact: true })
      .click();
    await page.getByRole("heading", { name: "LLM finishing order" }).waitFor();
    const saved = await download("Export generated race");
    assert.deepEqual(saved.outcome, record.outcome);
    assert.equal(saved.provenance.source, "chat-example");
    assert.deepEqual(saved.request, record.request);
    const first = record.outcome.finishOrder.find(
      (racer) => racer.place === 1
    ).id;
    await page
      .getByRole("heading", { name: new RegExp(`^1\\. ${first}$`, "i") })
      .waitFor();
  }
  report.tests.push(
    "All three attributed examples replay and export the exact LLM-authored outcomes and placings"
  );

  await page
    .getByRole("textbox", { name: "Mint's strategy" })
    .fill(
      "Feint toward the shadow exit, then move away if a visible rival commits. Otherwise keep climbing."
    );
  assert.equal(
    await page.getByRole("heading", { name: "LLM finishing order" }).count(),
    0
  );
  const prompt = await download("Export prompt");
  assert.equal(JSON.parse(prompt.user).participants.length, 3);
  assert.equal(
    JSON.parse(prompt.user).participants[0].strategy,
    await page.getByRole("textbox", { name: "Mint's strategy" }).inputValue()
  );
  assert.match(prompt.system, /ENTIRE race/);
  assert.equal(prompt.schema.additionalProperties, false);
  report.tests.push(
    "Editing a plan clears the old result; export carries all current plans, shared rules and output schema"
  );

  await page.getByRole("textbox", { name: "Nova's strategy" }).fill(" ");
  assert.equal(
    await page.getByRole("button", { name: "Export prompt" }).isDisabled(),
    true
  );
  await page
    .getByRole("alert")
    .filter({ hasText: "nonempty strategy" })
    .waitFor();
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await page
    .getByText("Import output from another LLM", { exact: true })
    .click();
  await page.getByRole("textbox", { name: "Generated race JSON" }).fill("{}");
  await page
    .getByRole("button", { name: "Load model output", exact: true })
    .click();
  assert.ok(await page.getByRole("alert").count());
  const orrery = records.find((record) => record.request.islandId === "M02");
  await page
    .getByRole("textbox", { name: "Generated race JSON" })
    .fill(JSON.stringify(orrery.outcome));
  await page
    .getByRole("button", { name: "Load model output", exact: true })
    .click();
  await page.getByText("Imported model output", { exact: true }).waitFor();
  report.tests.push(
    "Empty plans and invalid JSON are rejected; valid external output is explicitly labeled imported"
  );

  // This is a network fixture to exercise the UI, not an actual provider race.
  await page.route("**/api/racing/status", (route) =>
    route.fulfill({
      json: { configured: true, provider: "Test fixture", model: "mock-model" }
    })
  );
  let submitted;
  let fail = false;
  let gate;
  await page.route("**/api/racing/generate", async (route) => {
    submitted = route.request().postDataJSON();
    if (gate) await gate;
    await route.fulfill({
      // Return 200 with an invalid output for the failure case so there is no
      // manufactured HTTP resource error in the console error audit.
      json: {
        request: submitted,
        outcome: fail ? {} : orrery.outcome,
        provenance: {
          source: "live-llm",
          model: "mock-model",
          promptVersion: "yunipals-llm-race-v1",
          generatedAt: "2026-10-01",
          responseId: "fixture-response"
        }
      }
    });
  });
  await page.reload();
  await page.getByText("Connected to Test fixture", { exact: false }).waitFor();
  await page
    .getByRole("textbox", { name: "Mint's strategy" })
    .fill(
      "Draw a visible shot with a feint; then escape on a legal alternate line."
    );
  const sentPlans = await page
    .getByRole("textbox", { name: /'s strategy/ })
    .allTextContents();
  await page
    .getByRole("button", { name: "Generate full race", exact: true })
    .click();
  await page.getByText("Live LLM generation", { exact: true }).waitFor();
  assert.equal(submitted.strategies.length, 3);
  assert.deepEqual(
    submitted.strategies.map((entry) => entry.strategy),
    sentPlans
  );
  await page.getByRole("button", { name: "Finish order", exact: true }).click();
  const live = await download("Export generated race");
  assert.deepEqual(live.outcome, orrery.outcome);
  assert.equal(live.provenance.responseId, "fixture-response");
  report.tests.push(
    "Mocked live request submits all three current plans and displays the returned race without local adjudication"
  );

  fail = true;
  await page
    .getByRole("button", { name: "Generate full race", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  assert.equal(
    await page.getByText("Live LLM generation", { exact: true }).count(),
    0
  );
  assert.equal(
    await page
      .getByText("Stored chat-generated example", { exact: true })
      .count(),
    0
  );
  assert.equal(
    await page.getByRole("button", { name: "Generate full race" }).isEnabled(),
    true
  );
  report.tests.push(
    "Invalid model output shows an error and restores controls without substituting a stored result"
  );

  fail = false;
  let release;
  gate = new Promise((resolve) => {
    release = resolve;
  });
  await page
    .getByRole("button", { name: "Generate full race", exact: true })
    .click();
  await page
    .getByRole("button", { name: "LLM is generating the race…" })
    .waitFor();
  await page
    .getByRole("textbox", { name: "Mint's strategy" })
    .fill("Changed plan: take the safe connected route and keep moving.");
  release();
  gate = null;
  await page.waitForTimeout(150);
  assert.equal(
    await page.getByText("Live LLM generation", { exact: true }).count(),
    0
  );
  report.tests.push(
    "Editing during generation aborts the pending request and prevents a stale result from replacing the new plan"
  );

  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await page.getByRole("button", { name: "Finish order", exact: true }).click();
  await page.screenshot({
    path: `${values.output}/desktop.png`,
    fullPage: true
  });
  report.screenshots.push(`${values.output}/desktop.png`);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  );
  await page.screenshot({
    path: `${values.output}/mobile.png`,
    fullPage: true
  });
  report.screenshots.push(`${values.output}/mobile.png`);
  await page.getByRole("button", { name: "Previous beat" }).focus();
  await page.keyboard.press("Enter");
  await page
    .getByText(
      `Beat ${orrery.outcome.beats.length - 1}/${orrery.outcome.beats.length}`,
      { exact: false }
    )
    .waitFor();
  await page.getByRole("link", { name: "Yunipals home" }).click();
  await page.waitForURL(app.origin + "/");
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.getByRole("link", { name: "Race lab", exact: true }).click();
  await page.waitForURL(app.origin + "/race-lab");
  report.tests.push(
    "Desktop/mobile layouts, keyboard replay controls and home/race navigation work"
  );
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = error.stack;
  throw error;
} finally {
  await writeFile(
    `${values.output}/report.json`,
    JSON.stringify(report, null, 2) + "\n"
  );
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
