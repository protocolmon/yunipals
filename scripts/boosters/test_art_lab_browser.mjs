// Browser verification using the existing Chromium installation and its CDP.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const base = process.argv[2] || "http://127.0.0.1:5197";
const executable = process.argv[3] || "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
const expectedCards = 8;
const profile = await mkdtemp(path.join(tmpdir(), "yunipals-art-browser-"));
const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1440,1100", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let socket;
const requests = new Map();
let sequence = 0;
const exceptions = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chromium did not expose a debugging endpoint")), 15000);
    let output = "";
    browser.stderr.on("data", (chunk) => { output += chunk.toString(); const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    browser.once("exit", () => { clearTimeout(timer); reject(new Error("Chromium exited before the test started")); });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (!message.id) return;
    const pending = requests.get(message.id); if (!pending) return;
    requests.delete(message.id); clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 20000);
    requests.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const command = (method, params) => send(method, params, sessionId);
  await command("Page.enable"); await command("Runtime.enable");
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await delay(150); }
    throw new Error(`Browser condition failed: ${expression}; ${JSON.stringify(await evaluate('({motion:matchMedia("(prefers-reduced-motion: reduce)").matches,disabled:document.querySelector("#tilt-demo")?.disabled,auto:document.querySelector("#tilt-demo")?.getAttribute("aria-pressed")})'))}; exceptions: ${JSON.stringify(exceptions)}`);
  };
  const screenshot = async (name) => { const result = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); await writeFile(`/tmp/${name}.png`, Buffer.from(result.data, "base64")); };
  const captureViewer = async (name) => {
    const clip = await evaluate('(() => {const r=document.querySelector("#card-viewer").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()');
    const result = await command("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: false });
    await writeFile(`/tmp/${name}.png`, Buffer.from(result.data, "base64"));
  };
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await command("Page.navigate", { url: base });
  await waitFor(`document.querySelectorAll(".art-card").length === ${expectedCards} && document.querySelector("#count").textContent.includes("${expectedCards} cards ready")`);
  await waitFor('[...document.querySelectorAll(".card-button img")].every(image => image.complete && image.naturalWidth > 0)');
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  await screenshot("yunipals-booster-art-desktop");

  assert.equal(await evaluate('document.querySelector("#study-select")'), null);
  assert.equal(await evaluate('document.querySelector("#frame-filters")'), null);
  assert.equal(await evaluate('state.data.candidates.every(candidate => candidate.design.frameStyle === "brand")'), true);
  assert.equal(await evaluate('state.data.candidates.filter(candidate=>candidate.clarityProof?.review.decision==="accepted").length'), 2);
  assert.equal(await evaluate('state.data.gallery.designLock.id'), "lavender-crisp-v1");
  assert.equal(await evaluate('state.data.candidates.filter(candidate=>candidate.review.decision === "pending").length'), 4);
  assert.equal(await evaluate('state.data.candidates.filter(candidate=>candidate.colorProof && candidate.paletteReference).length'), 2);
  const revisedImages = await evaluate('state.data.candidates.filter(candidate=>candidate.traits.glitter==="Yes").map(candidate=>imageFor(candidate))');
  await evaluate('document.querySelector("#stage-select").value="revision";document.querySelector("#stage-select").dispatchEvent(new Event("change"))');
  assert.notDeepEqual(await evaluate('state.data.candidates.filter(candidate=>candidate.traits.glitter==="Yes").map(candidate=>imageFor(candidate))'), revisedImages);
  await waitFor('[...document.querySelectorAll(".card-button img")].every(image => image.complete && image.naturalWidth > 0)');
  await evaluate('document.querySelector("#stage-select").value="final";document.querySelector("#stage-select").dispatchEvent(new Event("change"))');
  await waitFor('[...document.querySelectorAll(".card-button img")].every(image => image.complete && image.naturalWidth > 0)');

  await evaluate('document.querySelector("[data-horn=Diamond]").click()');
  assert.equal(await evaluate('document.querySelectorAll(".art-card").length'), 4);
  await evaluate('document.querySelector("[data-glitter=Yes]").click()');
  assert.equal(await evaluate('document.querySelectorAll(".art-card").length'), 2);
  await evaluate('document.querySelector(".card-button").click()');
  assert.equal(await evaluate('document.querySelector("#review-dialog").open'), true);
  await waitFor('document.querySelector("#dialog-image").complete');
  assert.equal(await evaluate('document.querySelector("#dialog-image").src === document.querySelector("#full-image-link").href'), true, "The approved card PNG must remain the base artwork");
  assert.equal(await evaluate('document.querySelector("#foil-material")'), null);
  assert.deepEqual(await evaluate('[".tilt-foil",".tilt-sweep",".tilt-glare"].map(selector=>getComputedStyle(document.querySelector(selector)).mixBlendMode)'), ["color-dodge", "overlay", "overlay"]);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tilt-foil")).maskImage.includes(new URL(document.querySelector("#dialog-image").src).pathname)'), true);
  assert.equal(await evaluate('document.querySelector("#card-viewer").classList.contains("is-holo")'), true);
  const viewerPoint = (fx, fy) => evaluate(`(() => {const r=document.querySelector("#card-viewer").getBoundingClientRect();return {x:r.left+r.width*${fx},y:r.top+r.height*${fy}}})()`);
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...await viewerPoint(0.25, 0.3) });
  await waitFor('parseFloat(document.querySelector("#tilt-card").style.getPropertyValue("--rotate-y")) < 0');
  const cardFitsViewer = '(() => {const card=document.querySelector("#tilt-card").getBoundingClientRect(),viewer=document.querySelector("#card-viewer").getBoundingClientRect();return card.left >= viewer.left && card.right <= viewer.right && card.top >= viewer.top && card.bottom <= viewer.bottom})()';
  assert.equal(await evaluate(cardFitsViewer), true, "The whole tilted card must fit in its viewer");
  await screenshot("yunipals-booster-holo-left");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...await viewerPoint(0.8, 0.65) });
  await waitFor('parseFloat(document.querySelector("#tilt-card").style.getPropertyValue("--rotate-y")) > 0');
  assert.equal(await evaluate(cardFitsViewer), true);
  await screenshot("yunipals-booster-holo-right");
  // Isolate the new local sheen from the existing whole-card foil, then check
  // real pixels follow two different cursor positions without flooding the card.
  const hotspotPositions = [];
  for (const [name, fx, fy] of [["left", 0.3, 0.42], ["right", 0.77, 0.5]]) {
    const point = await viewerPoint(fx, fy);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await delay(350);
    await captureViewer(`yunipals-pointer-${name}-on`);
    await evaluate('document.querySelector(".tilt-hotspot").hidden=true');
    await captureViewer(`yunipals-pointer-${name}-off`);
    await evaluate('document.querySelector(".tilt-hotspot").hidden=false');
    hotspotPositions.push({name, ...await evaluate(`(() => {const r=document.querySelector("#card-viewer").getBoundingClientRect();return {x:${point.x}-r.x,y:${point.y}-r.y}})()`)});
  }
  const pointerPixels = JSON.parse(execFileSync("python3", ["-c", `
import json,math
from PIL import Image
positions=json.loads(${JSON.stringify(JSON.stringify(hotspotPositions))})
results=[]
for spot in positions:
    a=Image.open('/tmp/yunipals-pointer-'+spot['name']+'-on.png').convert('RGB')
    b=Image.open('/tmp/yunipals-pointer-'+spot['name']+'-off.png').convert('RGB')
    assert a.size==b.size
    count=near=total=wx=wy=0
    for i,(p,q) in enumerate(zip(a.getdata(),b.getdata())):
        d=sum(abs(x-y) for x,y in zip(p,q))/3
        if d<4: continue
        x,y=i%a.width,i//a.width
        count+=1;total+=d;wx+=x*d;wy+=y*d
        near+=math.hypot(x-spot['x'],y-spot['y'])<min(a.size)*.3
    results.append({'position':spot['name'],'changedFraction':count/(a.width*a.height),'nearPointerFraction':near/max(count,1),'centroidDistance':math.hypot(wx/max(total,1)-spot['x'],wy/max(total,1)-spot['y'])})
print(json.dumps(results))
`], { encoding: "utf8" }));
  for (const result of pointerPixels) {
    assert.ok(result.changedFraction > 0.003 && result.changedFraction < 0.22, JSON.stringify(result));
    assert.ok(result.nearPointerFraction > 0.9 && result.centroidDistance < 55, JSON.stringify(result));
  }
  // Isolate relighting and check pixels remain inside the artwork's star map.
  const starPositions = [];
  const depthProbes = [];
  for (const horn of ["Spiral", "Diamond"]) {
    await evaluate(`openCard(state.data.candidates.find(candidate=>candidate.traits.glitter==="Yes"&&candidate.traits.horn===${JSON.stringify(horn)}))`);
    await waitFor('document.querySelector("#artwork-stars img").complete && document.querySelector("#artwork-stars img").naturalWidth > 0');
    assert.equal(await evaluate('document.querySelector("#artwork-stars img").src === document.querySelector("#dialog-image").src'), true);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...await viewerPoint(0.66, 0.31) });
    await delay(400);
    const stars = await evaluate(`(() => {
      const card=document.querySelector("#tilt-card"),viewer=document.querySelector("#card-viewer");
      const stage=Object.values(state.selected.stages).find(stage=>new URL(stage.path,location.href).href===document.querySelector("#dialog-image").src);
      const matrix=new DOMMatrix(getComputedStyle(card).transform),perspective=parseFloat(getComputedStyle(viewer).perspective),bounds=viewer.getBoundingClientRect();
      return ART_STAR_MAPS[stage.sha256].map(([x,y,r])=>{const p=matrix.transformPoint(new DOMPoint((x/1024-.5)*card.offsetWidth,(y/1536-.5)*card.offsetHeight,0));const scale=1/(1-p.z/perspective);return {x:bounds.width/2+p.x*scale,y:bounds.height/2+p.y*scale,r:r/1024*card.offsetWidth*1.25}});
    })()`);
    assert.ok(stars.length >= 15);
    starPositions.push({horn,stars});
    assert.equal(await evaluate('document.querySelector("#tilt-card").classList.contains("has-monster-depth")'), true);
    assert.equal(await evaluate('document.querySelector(".monster-print").src === document.querySelector("#dialog-image").src'), true);
    const probes = await evaluate(`(() => {
      const card=document.querySelector("#tilt-card"),viewer=document.querySelector("#card-viewer"),bounds=viewer.getBoundingClientRect();
      const matrix=new DOMMatrix(getComputedStyle(card).transform),perspective=parseFloat(getComputedStyle(viewer).perspective);
      return [["monster",450,600],["monster",400,950],["monster",650,965],["background",140,620],["background",855,650],["background",840,900]].map(([region,x,y])=>{
        const p=matrix.transformPoint(new DOMPoint((x/1024-.5)*card.offsetWidth,(y/1536-.5)*card.offsetHeight,0));const scale=1/(1-p.z/perspective);
        return {region,x:bounds.width/2+p.x*scale,y:bounds.height/2+p.y*scale};
      });
    })()`);
    depthProbes.push({horn,probes});
    await captureViewer(`yunipals-depth-${horn}-on`);
    await evaluate('document.querySelector("#tilt-finish").click()');
    await waitFor('getComputedStyle(document.querySelector(".monster-depth")).opacity === "0" && getComputedStyle(document.querySelector(".tilt-foil")).opacity === "0"');
    await captureViewer(`yunipals-depth-${horn}-off`);
    await evaluate('document.querySelector("#tilt-finish").click()');
    await waitFor('getComputedStyle(document.querySelector(".monster-depth")).opacity === "1"');
    await evaluate('document.querySelector(".monster-depth").style.maskImage="none";document.querySelector(".monster-depth").style.webkitMaskImage="none";document.querySelector("#dialog-image").style.opacity=".15";document.querySelectorAll(".tilt-foil,.tilt-sweep,.tilt-diagonal,.tilt-sparkles,.tilt-glare,.tilt-hotspot,.tilt-art-stars").forEach(el=>el.style.visibility="hidden")');
    await captureViewer(`yunipals-depth-${horn}-silhouette`);
    await evaluate('document.querySelector(".monster-depth").style.removeProperty("mask-image");document.querySelector(".monster-depth").style.removeProperty("-webkit-mask-image");document.querySelector("#dialog-image").style.removeProperty("opacity");document.querySelectorAll(".tilt-foil,.tilt-sweep,.tilt-diagonal,.tilt-sparkles,.tilt-glare,.tilt-hotspot,.tilt-art-stars").forEach(el=>el.style.removeProperty("visibility"))');

    await captureViewer(`yunipals-stars-${horn}-on`);
    await evaluate('document.querySelector("#artwork-stars").hidden=true');
    await captureViewer(`yunipals-stars-${horn}-off`);
    await evaluate('document.querySelector("#artwork-stars").hidden=false');
  }
  const depthPixels = JSON.parse(execFileSync("python3", ["-c", `
import json
from PIL import Image
cards=json.loads(${JSON.stringify(JSON.stringify(depthProbes))})
results=[]
for card in cards:
    a=Image.open('/tmp/yunipals-depth-'+card['horn']+'-on.png').convert('RGB')
    b=Image.open('/tmp/yunipals-depth-'+card['horn']+'-off.png').convert('RGB')
    changes={'monster':[],'background':[]}
    for probe in card['probes']:
        deltas=[]
        for y in range(round(probe['y'])-4,round(probe['y'])+5):
            for x in range(round(probe['x'])-4,round(probe['x'])+5):
                deltas.append(sum(abs(p-q) for p,q in zip(a.getpixel((x,y)),b.getpixel((x,y))))/3)
        changes[probe['region']].append(sum(deltas)/len(deltas))
    results.append({'horn':card['horn'],'monsterMeanChange':sum(changes['monster'])/len(changes['monster']),'backgroundMeanChange':sum(changes['background'])/len(changes['background'])})
print(json.dumps(results))
`], {encoding:"utf8"}));
  for (const result of depthPixels) {
    assert.ok(result.monsterMeanChange < 0.5, JSON.stringify(result));
    assert.ok(result.backgroundMeanChange > 1, JSON.stringify(result));
  }
  const starPixels = JSON.parse(execFileSync("python3", ["-c", `
import json,math
from PIL import Image
positions=json.loads(${JSON.stringify(JSON.stringify(starPositions))})
results=[]
for card in positions:
    a=Image.open('/tmp/yunipals-stars-'+card['horn']+'-on.png').convert('RGB')
    b=Image.open('/tmp/yunipals-stars-'+card['horn']+'-off.png').convert('RGB')
    count=inside=0
    for i,(p,q) in enumerate(zip(a.getdata(),b.getdata())):
        if max(abs(x-y) for x,y in zip(p,q))<5:continue
        x,y=i%a.width,i//a.width
        count+=1
        inside+=any(math.hypot(x-s['x'],y-s['y'])<s['r'] for s in card['stars'])
    results.append({'horn':card['horn'],'mappedStars':len(card['stars']),'changedPixels':count,'insideStarMapFraction':inside/max(1,count),'changedFraction':count/(a.width*a.height)})
print(json.dumps(results))
`], {encoding:"utf8"}));
  for (const result of starPixels) {
    assert.ok(result.changedPixels > 50 && result.changedFraction < 0.08, JSON.stringify(result));
    assert.ok(result.insideStarMapFraction > 0.98, JSON.stringify(result));
  }
  await captureViewer("yunipals-diagonal-hint-on");
  await evaluate('document.querySelector(".tilt-diagonal").hidden=true');
  await captureViewer("yunipals-diagonal-hint-off");
  await evaluate('document.querySelector(".tilt-diagonal").hidden=false');
  const diagonalHint = JSON.parse(execFileSync("python3", ["-c", `
import json
from PIL import Image,ImageChops,ImageStat
a=Image.open('/tmp/yunipals-diagonal-hint-on.png').convert('RGB')
b=Image.open('/tmp/yunipals-diagonal-hint-off.png').convert('RGB')
print(json.dumps({'meanChannelChange':sum(ImageStat.Stat(ImageChops.difference(a,b)).mean)/3}))
`], {encoding:"utf8"}));
  assert.ok(diagonalHint.meanChannelChange > 0.01 && diagonalHint.meanChannelChange < 2, JSON.stringify(diagonalHint));
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
  await delay(300);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tilt-hotspot")).opacity'), "0");
  // Compare actual rendered pixels at the same card pose.
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...await viewerPoint(0.28, 0.45) });
  await waitFor('parseFloat(document.querySelector("#tilt-card").style.getPropertyValue("--rotate-y")) < 0');
  await delay(250);
  await captureViewer("yunipals-foil-visible-on");
  await evaluate('document.querySelector("#tilt-finish").click()');
  await waitFor('getComputedStyle(document.querySelector(".tilt-foil")).opacity === "0" && getComputedStyle(document.querySelector(".tilt-hotspot")).opacity === "0"');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tilt-foil")).opacity'), "0");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tilt-sweep")).opacity'), "0");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tilt-hotspot")).opacity'), "0");
  await captureViewer("yunipals-foil-visible-off");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tilt-art-stars")).opacity'), "0");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tilt-diagonal")).opacity'), "0");
  // Compare actual browser pixels at the same pose: a changing CSS property alone
  // did not prove that the previous brightening layer looked like rainbow foil.
  const foilPixels = JSON.parse(execFileSync("python3", ["-c", `
import json
from PIL import Image
a=Image.open('/tmp/yunipals-foil-visible-on.png').convert('RGB')
b=Image.open('/tmp/yunipals-foil-visible-off.png').convert('RGB')
assert a.size == b.size
changed=chroma=total=0
for p,q in zip(a.getdata(),b.getdata()):
    d=[x-y for x,y in zip(p,q)]
    changed += max(map(abs,d)) > 15
    chroma += max(d)-min(d) > 18
    total += sum(map(abs,d))/3
n=a.width*a.height
print(json.dumps({'changedFraction':changed/n,'colorShiftFraction':chroma/n,'meanChannelChange':total/n}))
`], { encoding: "utf8" }));
  assert.ok(foilPixels.changedFraction > 0.015, JSON.stringify(foilPixels));
  assert.ok(foilPixels.meanChannelChange > 0.8, "The foil must visibly change the rendered card");
  await evaluate('document.querySelector("#tilt-finish").click()');
  const comparisonPose = await evaluate('document.querySelector("#tilt-card").style.transform || ["--rotate-x","--rotate-y"].map(key=>document.querySelector("#tilt-card").style.getPropertyValue(key)).join()');
  const optionPoint = await evaluate('(() => {const r=document.querySelector("button[data-foil-style=prism]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...optionPoint });
  assert.equal(await evaluate('document.querySelectorAll("button[data-foil-style]").length'), 3);
  for (const style of ["prism", "diagonal", "glitter"]) {
    await evaluate(`document.querySelector('button[data-foil-style="${style}"]').click()`);
    assert.equal(await evaluate('document.querySelector("#card-viewer").dataset.foilStyle'), style);
    assert.equal(await evaluate('document.querySelectorAll("button[data-foil-style][aria-pressed=true]").length'), 1);
    assert.equal(await evaluate('["--rotate-x","--rotate-y"].map(key=>document.querySelector("#tilt-card").style.getPropertyValue(key)).join()'), comparisonPose);
    await delay(300);
    await captureViewer(`yunipals-foil-treatment-${style}`);
  }
  const foilComparisons = JSON.parse(execFileSync("python3", ["-c", `
import json
from PIL import Image
names=['prism','diagonal','glitter']
images={name:Image.open('/tmp/yunipals-foil-treatment-'+name+'.png').convert('RGB') for name in names}
results=[]
for i,left in enumerate(names):
    for right in names[i+1:]:
        a,b=images[left],images[right]
        assert a.size == b.size
        total=sum(sum(abs(x-y) for x,y in zip(p,q))/3 for p,q in zip(a.getdata(),b.getdata()))
        results.append({'pair':[left,right],'meanChannelChange':total/(a.width*a.height)})
print(json.dumps(results))
`], { encoding: "utf8" }));
  for (const result of foilComparisons) assert.ok(result.meanChannelChange > 0.25, JSON.stringify(result));
  await evaluate('document.querySelector("button[data-foil-style=prism]").click();document.querySelector("#tilt-finish").click()');
  await evaluate('document.querySelector("#tilt-finish").click();document.querySelector("#holo-intensity").value="0";document.querySelector("#holo-intensity").dispatchEvent(new Event("input"))');
  await delay(300);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tilt-foil")).opacity'), "0");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tilt-sweep")).opacity'), "0");
  await evaluate('document.querySelector("#holo-intensity").value="85";document.querySelector("#holo-intensity").dispatchEvent(new Event("input"));document.querySelector("#tilt-finish").click()');
  await evaluate('document.querySelector("#tilt-finish").click();document.querySelector("#tilt-reset").click();document.querySelector("#card-viewer").focus()');
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await waitFor('parseFloat(document.querySelector("#tilt-card").style.getPropertyValue("--rotate-y")) > 0');
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Home", code: "Home", windowsVirtualKeyCode: 36 });
  assert.equal(await evaluate('parseFloat(document.querySelector("#tilt-card").style.getPropertyValue("--rotate-y"))'), 0);
  await evaluate('document.querySelector("#tilt-demo").click()');
  await waitFor('parseFloat(document.querySelector("#tilt-card").style.getPropertyValue("--rotate-y")) !== 0');
  await evaluate('document.querySelector("button[data-foil-style=diagonal]").click()');
  assert.equal(await evaluate('document.querySelector("#tilt-demo").getAttribute("aria-pressed")'), "true");
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await waitFor('document.querySelector("#tilt-demo").disabled && document.querySelector("#tilt-demo").getAttribute("aria-pressed") === "false"');
  assert.equal(await evaluate('parseFloat(document.querySelector("#tilt-card").style.getPropertyValue("--rotate-y"))'), 0);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tilt-foil")).display'), "none");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tilt-hotspot")).display'), "none");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#tilt-card")).transform'), "none");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tilt-art-stars")).display'), "none");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".monster-depth")).display'), "none");
  await command("Emulation.setEmulatedMedia", { features: [] });
  await evaluate('document.querySelector("button[data-foil-style=prism]").click()');
  await evaluate('document.querySelector("[data-decision=like]").click(); document.querySelector("#review-note").value = "Browser test: clear diamond horn and glitter"; document.querySelector("#review-note").dispatchEvent(new Event("input", {bubbles:true}))');
  await evaluate('document.querySelector("[data-surface=white]").click()'); await screenshot("yunipals-booster-art-cutout-light");
  await evaluate('document.querySelector("[data-surface=dark]").click()'); await screenshot("yunipals-booster-art-cutout-dark");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  assert.equal(await evaluate('document.querySelector("#review-dialog").open'), false);

  await command("Page.reload");
  await waitFor(`document.querySelectorAll(".art-card").length === ${expectedCards}`);
  assert.equal(await evaluate('document.querySelectorAll(".feedback-dot").length'), 1);
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("yunipals-booster-art-reviews-v1"))[Object.keys(JSON.parse(localStorage.getItem("yunipals-booster-art-reviews-v1")))[0]].note'), "Browser test: clear diamond horn and glitter");
  assert.equal(await evaluate('Object.values(JSON.parse(localStorage.getItem("yunipals-booster-art-reviews-v1")))[0].foilPreview.style'), "prism");
  await waitFor('document.querySelector("#prepare-button").textContent.includes("Prepare generation")');
  const before = await readFile("docs/boosters/artwork-prototype/runs/yunidragon-blue-spiral-glitter-no-c2877facdb-a01/run.json", "utf8");
  await evaluate('document.querySelector("#request-form").requestSubmit()');
  await waitFor('document.querySelector("#request-status").textContent.includes("already has a complete candidate")');
  assert.equal(await readFile("docs/boosters/artwork-prototype/runs/yunidragon-blue-spiral-glitter-no-c2877facdb-a01/run.json", "utf8"), before);

  // Preparation re-exports the manifest. Verify the resulting page again before
  // packaging, including its thumbnails, rather than only checking the first load.
  await command("Page.reload");
  await waitFor(`document.querySelectorAll(".art-card").length === ${expectedCards}`);
  await waitFor('[...document.querySelectorAll(".card-button img")].every(image => image.complete && image.naturalWidth > 0)');
  assert.equal(await evaluate('[...document.querySelectorAll(".card-button img")].every(image => new URL(image.src).pathname.startsWith("/assets/"))'), true);
  await evaluate('document.querySelector(".card-button").click()');
  assert.equal(await evaluate('document.querySelector("#tilt-finish").disabled'), true);
  assert.equal(await evaluate('document.querySelector("#holo-intensity-control").hidden'), true);
  assert.equal(await evaluate('document.querySelector("#foil-style-controls").hidden'), true);
  assert.equal(await evaluate('document.querySelector("#artwork-stars").hidden'), true);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tilt-foil")).opacity'), "0");
  await evaluate('document.querySelector("#close-dialog").click()');

  // Check each sample's OG reference and the new wings/flippers in real pixels.
  const sampleDepthProbes = [];
  for (const species of ["Yunikles", "Yunichick", "Yuniturtle", "Yunifairy"]) {
    await evaluate(`openCard(state.data.candidates.find(candidate=>candidate.traits.type===${JSON.stringify(species)}))`);
    await waitFor('["#dialog-image","#dialog-reference"].every(selector=>{const image=document.querySelector(selector);return image.complete && image.naturalWidth>0})');
    assert.equal(await evaluate('document.querySelector("#dialog-reference").src === new URL((state.selected.paletteReference?.monsterType===state.selected.traits.type ? state.selected.paletteReference : state.data.references[state.selected.traits.type]).image,location.href).href'), true);
    assert.equal(await evaluate('document.querySelector("#dialog-image").naturalWidth'), 1024);
    if (["Yunichick", "Yuniturtle"].includes(species)) {
      await waitFor('!document.querySelector("#palette-reference-row").hidden && document.querySelector("#dialog-palette").complete && document.querySelector("#dialog-palette").naturalWidth>0');
      assert.equal(await evaluate('document.querySelector("#dialog-palette").src === new URL(state.selected.paletteReference.image,location.href).href'), true);
      assert.equal(await evaluate('stageFor(state.selected)'), "palette");
      assert.equal(await evaluate('state.selected.paletteReference.monsterType === state.selected.traits.type && state.selected.paletteReference.color === state.selected.traits.color'), true);
      const corrected = await evaluate('document.querySelector("#dialog-image").src');
      await evaluate('state.stage="revision";openCard(state.selected)');
      await waitFor('document.querySelector("#dialog-image").complete && document.querySelector("#dialog-image").naturalWidth>0');
      assert.equal(await evaluate('stageFor(state.selected)'), "card");
      assert.notEqual(await evaluate('document.querySelector("#dialog-image").src'), corrected);
      assert.equal(await evaluate('document.querySelector("#prompt-select").value'), "card");
      await evaluate('state.stage="final";openCard(state.selected)');
      await waitFor('document.querySelector("#dialog-image").complete && document.querySelector("#dialog-image").naturalWidth>0');
    } else assert.equal(await evaluate('document.querySelector("#palette-reference-row").hidden'), true);
    const holo = await evaluate('state.selected.traits.glitter === "Yes"');
    assert.equal(await evaluate('document.querySelector("#tilt-finish").disabled'), !holo);
    if (holo) {
      assert.equal(await evaluate('document.querySelector("#tilt-card").classList.contains("has-monster-depth")'), true);
      assert.ok(await evaluate('ART_STAR_MAPS[state.selected.stages.card.sha256].length') >= 10);
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...await viewerPoint(0.66, 0.31) });
      await delay(400);
      const sourceProbes = species === "Yuniturtle"
        ? [["monster",430,690],["monster",400,1000],["monster",650,1120],["monster",550,930],["background",140,650],["background",850,650],["background",900,1150]]
        : [["monster",430,660],["monster",500,950],["monster",250,650],["monster",730,700],["background",130,700],["background",860,550],["background",850,1180]];
      const probes = await evaluate(`(() => {
        const card=document.querySelector("#tilt-card"),viewer=document.querySelector("#card-viewer"),bounds=viewer.getBoundingClientRect();
        const matrix=new DOMMatrix(getComputedStyle(card).transform),perspective=parseFloat(getComputedStyle(viewer).perspective);
        return ${JSON.stringify(sourceProbes)}.map(([region,x,y])=>{
          const p=matrix.transformPoint(new DOMPoint((x/1024-.5)*card.offsetWidth,(y/1536-.5)*card.offsetHeight,0));const scale=1/(1-p.z/perspective);
          return {region,x:bounds.width/2+p.x*scale,y:bounds.height/2+p.y*scale};
        });
      })()`);
      sampleDepthProbes.push({species,probes});
      await captureViewer(`yunipals-sample-${species}-on`);
      await evaluate('document.querySelector("#tilt-finish").click()');
      await waitFor('getComputedStyle(document.querySelector(".tilt-foil")).opacity === "0"');
      await captureViewer(`yunipals-sample-${species}-off`);
      await evaluate('document.querySelector("#tilt-finish").click()');
      await waitFor('getComputedStyle(document.querySelector(".monster-depth")).opacity === "1"');
      await evaluate('document.querySelector(".monster-depth").style.maskImage="none";document.querySelector(".monster-depth").style.webkitMaskImage="none";document.querySelector("#dialog-image").style.opacity=".15";document.querySelectorAll(".tilt-foil,.tilt-sweep,.tilt-diagonal,.tilt-sparkles,.tilt-glare,.tilt-hotspot,.tilt-art-stars").forEach(el=>el.style.visibility="hidden")');
      await captureViewer(`yunipals-sample-${species}-silhouette`);
      await evaluate('document.querySelector(".monster-depth").style.removeProperty("mask-image");document.querySelector(".monster-depth").style.removeProperty("-webkit-mask-image");document.querySelector("#dialog-image").style.removeProperty("opacity");document.querySelectorAll(".tilt-foil,.tilt-sweep,.tilt-diagonal,.tilt-sparkles,.tilt-glare,.tilt-hotspot,.tilt-art-stars").forEach(el=>el.style.removeProperty("visibility"))');
    }
    await evaluate('document.querySelector("#close-dialog").click()');
  }
  const sampleDepthPixels = JSON.parse(execFileSync("python3", ["-c", `
import json
from PIL import Image
results=[]
for card in json.loads(${JSON.stringify(JSON.stringify(sampleDepthProbes))}):
    a=Image.open('/tmp/yunipals-sample-'+card['species']+'-on.png').convert('RGB')
    b=Image.open('/tmp/yunipals-sample-'+card['species']+'-off.png').convert('RGB')
    changes={'monster':[],'background':[]}
    for probe in card['probes']:
        deltas=[sum(abs(p-q) for p,q in zip(a.getpixel((x,y)),b.getpixel((x,y))))/3 for y in range(round(probe['y'])-4,round(probe['y'])+5) for x in range(round(probe['x'])-4,round(probe['x'])+5)]
        changes[probe['region']].append(sum(deltas)/len(deltas))
    results.append({'species':card['species'],'monsterMeanChange':sum(changes['monster'])/len(changes['monster']),'backgroundMeanChange':sum(changes['background'])/len(changes['background'])})
print(json.dumps(results))
`], {encoding:"utf8"}));
  for (const result of sampleDepthPixels) {
    assert.ok(result.monsterMeanChange < 0.5, JSON.stringify(result));
    assert.ok(result.backgroundMeanChange > 1, JSON.stringify(result));
  }

  await evaluate('window.fallbackCandidate=state.data.candidates.find(candidate=>candidate.colorProof); window.fallbackStage=window.fallbackCandidate.stageOrder.at(-1); window.fallbackCandidate.stages[window.fallbackStage].preview = "assets/intentionally-missing-preview.webp"; renderCards()');
  await waitFor('[...document.querySelectorAll(".card-button img")].some(image => new URL(image.src).pathname.endsWith(window.fallbackCandidate.stages[window.fallbackStage].path) && image.complete && image.naturalWidth > 0)');
  await waitFor('[...document.querySelectorAll(".card-button img")].every(image => image.complete && image.naturalWidth > 0)');

  // Exercise the hosted gallery path without the loopback queue adapter.
  await evaluate('state.local = false; Object.defineProperty(navigator, "clipboard", {configurable:true, value:{writeText:async text=>{window.copiedArtRequest=text}}}); document.querySelector("#type-select").value="Yunifairy"; document.querySelector("#color-select").value="Black"; document.querySelector("#horn-select").value="Diamond"; document.querySelector("#glitter-select").value="Yes"; document.querySelector("#request-form").requestSubmit()');
  await waitFor('typeof window.copiedArtRequest === "string"');
  assert.match(await evaluate("window.copiedArtRequest"), /Yunifairy.*Black.*Diamond.*Yes/);
  assert.match(await evaluate("window.copiedArtRequest"), /body AND holographic/);
  assert.match(await evaluate("window.copiedArtRequest"), /approved brand lavender frame/);

  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("window.scrollTo(0,0)");
  await delay(200);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  await screenshot("yunipals-booster-art-mobile");
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#cards")).gridTemplateColumns.split(" ").length'), 2);
  await evaluate('openCard(state.data.candidates.find(candidate=>candidate.traits.glitter === "Yes"))');
  await waitFor('document.querySelector("#dialog-image").complete && document.querySelector("#dialog-image").naturalWidth > 0');
  await command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{...await viewerPoint(0.3, 0.4),id:1}] });
  await command("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{...await viewerPoint(0.75, 0.65),id:1}] });
  await waitFor('parseFloat(document.querySelector("#tilt-card").style.getPropertyValue("--rotate-y")) > 0');
  await command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await delay(300);
  assert.ok(Number(await evaluate('getComputedStyle(document.querySelector(".tilt-hotspot")).opacity')) > 0);
  assert.equal(await evaluate(cardFitsViewer), true);
  for (const style of ["prism", "diagonal", "glitter"]) {
    await evaluate(`document.querySelector('button[data-foil-style="${style}"]').click()`);
    assert.equal(await evaluate('document.querySelector("#card-viewer").dataset.foilStyle'), style);
  }
  assert.equal(await evaluate('document.querySelector("#review-dialog").open'), true);
  assert.equal(await evaluate('document.querySelector("#review-dialog").scrollWidth <= document.querySelector("#review-dialog").clientWidth'), true);
  await screenshot("yunipals-booster-holo-mobile");
  await evaluate('document.querySelector("#close-dialog").click()');
  assert.equal(await evaluate('document.querySelector("#tilt-demo").getAttribute("aria-pressed")'), "false");
  assert.deepEqual(exceptions, []);

  const forbidden = await fetch(`${base}/api/prepare`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://unrelated.example" }, body: JSON.stringify({ type: "Yunidragon", color: "Blue", horn: "Spiral", glitter: "No" }) });
  assert.equal(forbidden.status, 403);
  const report = { passed: true, lockedDesign: "lavender-crisp-v1", newSamples: 4, paletteCorrections: 2, paletteReferenceComparison: true, sampleDepthPixels, cards: expectedCards, lavenderOnly: true, alternativeStylesRemoved: true, filters: true, modalAndEscape: true, feedbackPersistence: true, duplicateRequestReused: true, hostedRequestCopy: true, tiltMouse: true, tiltTouch: true, tiltKeyboard: true, holoToggle: true, holoIntensity: true, foilPixels, pointerPixels, depthPixels, starPixels, diagonalHint, pointerSheen: true, foilComparisons, protobitsCss: true, approvedSourcesPreserved: true, bodyClarityProofs: 2, previousArtworkComparison: true, alphaMaskedLayers: true, threeFoilTreatments: true, foilChoiceInFeedback: true, classicWithoutFoil: true, autoTilt: true, reducedMotion: true, mobileWidth: 390, horizontalOverflow: false, crossOriginQueueRejected: true, runtimeExceptions: exceptions };
  await writeFile("/tmp/yunipals-booster-art-browser-report.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  await send("Browser.close").catch(() => {});
} finally {
  socket?.close();
  browser.kill("SIGTERM");
  for (const pending of requests.values()) clearTimeout(pending.timer);
  await delay(200);
  await rm(profile, { recursive: true, force: true });
}
