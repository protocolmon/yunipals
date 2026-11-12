/** Produce an offline review of verified test artwork, spells and onchain grades. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderPortalSlab } from "@protopals/yunipals-market-core/portalSlab";
import { portalAssetHash } from "../lib/portals/assets.js";

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );
async function main() {
  const directory = process.env.PORTALS_ELEVEN_DIRECTORY;
  assert(directory);
  const proof = JSON.parse(
    await readFile(join(directory, "independent-verification.json"), "utf8")
  );
  const results = JSON.parse(
    await readFile(join(directory, "results.json"), "utf8")
  ) as {
    ordinal: number;
    tokenId: string;
    title: string;
    spell: string;
    result: {
      artwork: { hash: `0x${string}` };
      scores: [number, number, number, number];
      copied: boolean;
    };
    report: {
      reason: string;
      effectiveImagePrompt: string;
      models: { image: string; grading: string };
      scores: {
        creativity: number;
        harmony: number;
        craft: number;
        impact: number;
      };
      gradingAssessment: unknown;
    };
  }[];
  assert.equal(results.length, 11);
  const rows = await Promise.all(
    results.map(async (row) => {
      const bytes = await readFile(
        join(directory, "assets", `${row.result.artwork.hash.slice(2)}.png`)
      );
      assert.equal(portalAssetHash(bytes), row.result.artwork.hash);
      const imageURI = `data:image/png;base64,${bytes.toString("base64")}`;
      const slab = renderPortalSlab({
        kindId: "1",
        imageURI,
        title: row.title,
        scores: row.report.scores,
        tokenId: row.tokenId,
        version: "1"
        // The offline bundle already contains the verified PNG. Reference it once
        // instead of duplicating megabytes in both SVG image attributes.
      }).replaceAll(imageURI, `assets/${row.result.artwork.hash.slice(2)}.png`);
      const rank =
        proof.rankings.findIndex(
          (r: { entry: string }) => r.entry === String(row.ordinal)
        ) + 1;
      const prize = rank <= 3 ? ["2.75", "1.65", "1.10"][rank - 1] : null;
      return {
        rank,
        html: `<article data-entry="${row.ordinal}" data-rank="${rank}" id="entry-${row.ordinal}"><div class="badge">#${rank}${prize ? ` · ${prize} TESTUSDC paid` : ""}<span>Entry ${row.ordinal}</span></div>${slab}<div class="body"><h2>${escape(row.title)}</h2><p class="scores">${row.result.scores.map((score, i) => `${["Creativity", "Harmony", "Craft", "Impact"][i]} <b>${score}</b>`).join(" · ")}</p><h3>Your spell</h3><p class="spell">${escape(row.spell)}</p><details><summary>Why these grades?</summary><p>${escape(row.report.reason)}</p><pre>${escape(JSON.stringify(row.report.gradingAssessment, null, 2))}</pre></details><details><summary>Complete image prompt + models</summary><p>${escape(row.report.effectiveImagePrompt)}</p><p>${escape(row.report.models.image)} · ${escape(row.report.models.grading)}</p><p>Copied spell: ${row.result.copied ? "Yes" : "No"}</p></details><a class="download" href="assets/${row.result.artwork.hash.slice(2)}.png" download>Download artwork PNG</a></div></article>`
      };
    })
  );
  rows.sort((a, b) => a.rank - b.rank);
  const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yunipals · Eleven spell challenge</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f6f2ff;color:#302444;font:16px/1.55 system-ui,sans-serif}header{padding:48px max(24px,calc((100vw - 1340px)/2));background:linear-gradient(115deg,#ffdae9,#fff0c1 35%,#d7faea 66%,#d8e9ff);border-bottom:1px solid #ded4ee}h1{font-size:clamp(30px,4vw,52px);line-height:1.12;margin:10px 0 18px;max-width:820px}header p{max-width:850px}.eyebrow{font-weight:800;letter-spacing:.12em;font-size:12px}.stats{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}.stats span{padding:10px 16px;border:1px solid #fff;border-radius:100px;background:#ffffffb0;font-weight:700}a{color:#6531aa}nav{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:24px 0}button{font:inherit;border:1px solid #ccb9e6;background:white;border-radius:100px;padding:10px 18px;cursor:pointer}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #8256d8;outline-offset:3px}main{max-width:1390px;padding:0 24px 48px;margin:auto}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}article{background:white;border:1px solid #e4d9f0;border-radius:28px;overflow:hidden;box-shadow:0 8px 28px #5131770b}article>svg{display:block;width:100%;height:auto;padding:18px 22px 0}.badge{display:flex;justify-content:space-between;background:#eaddff;color:#4e247e;padding:12px 18px;font-weight:800;font-size:14px}.badge span{font-weight:500}.body{padding:4px 24px 24px}h2{font-size:23px;line-height:1.2}h3{font-size:14px;margin-bottom:6px}.scores{font-size:13px;color:#674f7d}.spell{font-size:15px;margin-top:0}details{border-top:1px solid #e9e1f1;padding:14px 0;font-size:14px}summary{cursor:pointer;font-weight:700}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;max-height:400px;overflow:auto}.download{display:inline-block;margin-top:10px;font-size:14px}footer{padding:24px;font-size:13px;text-align:center;color:#665679}@media(max-width:1000px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:640px){.grid{grid-template-columns:1fr}header{padding:32px 24px}main{padding:0 16px 32px}}@media print{.grid{grid-template-columns:repeat(2,minmax(0,1fr))}article{break-inside:avoid}nav{display:none}}
  </style><header><div class="eyebrow">YUNIPALS TCG · BASE SEPOLIA REHEARSAL</div><h1>Eleven spells.<br>One Rainbow challenge.</h1><p>Real spell submissions, AI-generated card edits and four onchain grades per card. A winning test wallet resolved the challenge and the contract paid all three prizes.</p><div class="stats"><span>11 real artwork edits</span><span>11 onchain grades</span><span>5.50 TESTUSDC paid</span></div><p>Each entry cost 0.99 TESTUSDC: 0.245 for AI, 0.245 in portal earnings and 0.50 for the prize pool. The top three split it 50% / 30% / 20%. Production stays at 111 entries.</p><p><a href="https://sepolia.basescan.org/tx/${escape(proof.resolutionTransaction)}" target="_blank" rel="noreferrer">View the winner’s settlement transaction ↗</a> · <a href="independent-verification.json">Download verification</a></p></header><main><nav aria-label="Artwork order"><strong>Review the results</strong><button type="button" data-sort="rank">Rank order</button><button type="button" data-sort="entry">Submission order</button></nav><div class="grid">${rows.map((r) => r.html).join("\n")}</div></main><footer>Isolated test deployment · Test currency has no monetary value · AI artwork files are unchanged; the Rainbow slab is a display layer.<br>Verified ${escape(proof.verifiedAt)} · API and metadata routes were exercised privately in process.</footer><script>document.querySelectorAll('[data-sort]').forEach(b=>b.addEventListener('click',()=>{const g=document.querySelector('.grid');[...g.children].sort((a,c)=>Number(a.dataset[b.dataset.sort])-Number(c.dataset[b.dataset.sort])).forEach(a=>g.append(a))}));</script></html>`;
  await writeFile(join(directory, "review.html"), page, { mode: 0o600 });
  console.log(
    `Saved offline review with ${results.length} real artwork slabs.`
  );
}
main().catch(() => {
  console.error("Review export failed verification.");
  process.exitCode = 1;
});
