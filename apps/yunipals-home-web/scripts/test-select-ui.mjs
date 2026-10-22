import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createServer, transformWithEsbuild } from "vite";

const { values } = parseArgs({
  options: {
    playwright: { type: "string" },
    chromium: { type: "string" }
  }
});
const { chromium } = await import(
  values.playwright ? pathToFileURL(values.playwright).href : "playwright"
);
const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
async function checkSource(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await checkSource(path);
    else if (entry.name.endsWith(".tsx"))
      assert(
        !/<select\b/.test(await readFile(path, "utf8")),
        `Use the shared Select in ${path}`
      );
  }
}
await checkSource(`${root}/src`);
const virtual = "virtual:select-check.tsx";
const source = `
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Select,SelectItem} from '/src/components/ui/select';
import '/src/globals.css';
function Demo(){
 const [origin,setOrigin]=useState('all'),[duration,setDuration]=useState('day'),[submitted,setSubmitted]=useState('');
 const dialog=useRef(null);
 return <main className="mx-auto max-w-xl space-y-6 p-4">
  <h1 className="text-xl font-bold">Shared dropdown check</h1>
  <form onSubmit={e=>{e.preventDefault();setSubmitted(new FormData(e.currentTarget).get('origin'));}}>
   <label htmlFor="origin">Island origin</label>
   <Select id="origin" name="origin" value={origin} onValueChange={setOrigin} className="w-full px-3">
    <SelectItem value="all">All islands</SelectItem>
    <SelectItem value="original">Original · Ethereum</SelectItem>
    <SelectItem value="airdrop">Airdropped · Base</SelectItem>
    <SelectItem value="unsupported" disabled>Unavailable island</SelectItem>
   </Select>
   <button type="submit">Submit selection</button><output aria-label="Submitted value">{submitted}</output>
  </form>
  <Select aria-label="Unavailable control" value="all" disabled><SelectItem value="all">Unavailable</SelectItem></Select>
  <button onClick={()=>dialog.current.showModal()}>Open order dialog</button>
  <dialog ref={dialog} className="w-80 rounded-card border border-line p-6 shadow-card">
   <label htmlFor="duration">Expires after</label>
   <Select id="duration" value={duration} onValueChange={setDuration} variant="field" className="w-full">
    <SelectItem value="day">One day</SelectItem><SelectItem value="month">Thirty days</SelectItem>
   </Select>
   <button onClick={()=>dialog.current.close()}>Close dialog</button>
  </dialog>
 </main>;
}
createRoot(document.getElementById('root')).render(<Demo/>);`;
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "select-check",
      resolveId(id) {
        if (id === virtual) return "\0" + virtual;
      },
      load(id) {
        if (id === "\0" + virtual)
          return transformWithEsbuild(source, virtual, {
            loader: "tsx",
            jsx: "automatic"
          });
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url !== "/__select-check") return next();
          const html = await vite.transformIndexHtml(
            req.url,
            `<html><body><div id="root"></div><script type="module" src="/@id/__x00__${virtual}"></script></body></html>`
          );
          res.setHeader("Content-Type", "text/html");
          res.end(html);
        });
      }
    }
  ]
});
await server.listen();
const address = server.httpServer.address();
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:${address.port}/__select-check`);
  const origin = page.getByRole("combobox", { name: "Island origin" });
  await origin.waitFor();
  const inset = await origin.evaluate(
    (element) =>
      element.getBoundingClientRect().right -
      element.querySelector("[data-select-arrow]").getBoundingClientRect().right
  );
  assert(inset >= 16 && inset <= 18, `Arrow inset ${inset}`);
  await origin.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("listbox").waitFor();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("role") === "option"
  );
  await page.keyboard.press("End");
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("data-select-value") === "airdrop"
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document.getElementById("origin")?.getAttribute("data-select-value") ===
      "airdrop"
  );
  await page.waitForFunction(() => document.activeElement?.id === "origin");
  assert.equal(await origin.getAttribute("data-select-value"), "airdrop");
  assert.equal(await page.evaluate(() => document.activeElement.id), "origin");
  await page.getByRole("button", { name: "Submit selection" }).click();
  assert.equal(await page.getByLabel("Submitted value").innerText(), "airdrop");
  await origin.click();
  const selected = page.getByRole("option", {
    name: "Airdropped · Base",
    exact: true
  });
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("data-select-value") === "airdrop"
  );
  assert.equal(await selected.getAttribute("aria-selected"), "true");
  assert((await selected.locator("svg").count()) > 0);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("listbox").count(), 0);
  await page.getByRole("button", { name: "Open order dialog" }).click();
  const duration = page.getByRole("combobox", { name: "Expires after" });
  await duration.click();
  assert.equal(await page.getByRole("dialog").getByRole("listbox").count(), 1);
  await page.getByRole("option", { name: "Thirty days", exact: true }).click();
  assert.equal(await duration.getAttribute("data-select-value"), "month");
  await duration.click();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 1);
  await page.getByRole("button", { name: "Close dialog" }).click();
  assert(
    await page
      .getByRole("combobox", { name: "Unavailable control" })
      .isDisabled()
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await origin.click();
  const bounds = await page.getByRole("listbox").boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  );
  await page.screenshot({ path: "/tmp/yunipals-shared-select-mobile.png" });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1100, height: 900 });
  await origin.click();
  await page.screenshot({ path: "/tmp/yunipals-shared-select-desktop.png" });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        sharedControlsOnly: true,
        arrowInset: inset,
        keyboardAndFocus: true,
        formValue: true,
        disabledChoices: true,
        nativeDialogPortal: true,
        escapeKeepsDialogOpen: true,
        mobileFits: true,
        pageErrors: errors
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
  await server.close();
}
