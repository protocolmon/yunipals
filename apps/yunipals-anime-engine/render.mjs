import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import http from "node:http";
import { join, dirname, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const digest = (b) => createHash("sha256").update(b).digest("hex");
export async function checkEngineLock() {
  const lock = JSON.parse(
    await readFile(join(root, "engine-lock.json"), "utf8")
  );
  for (const [name, hash] of Object.entries(lock.files))
    if (digest(await readFile(join(root, name))) !== hash)
      throw new Error(`Engine changed without a version bump: ${name}`);
  if (
    digest(
      JSON.stringify(
        Object.fromEntries(
          Object.keys(lock.files)
            .sort()
            .map((key) => [key, lock.files[key]])
        )
      )
    ) !== lock.sha256
  )
    throw new Error("Invalid engine lock");
  return lock;
}
export async function withFilm(job, callback) {
  const lock = await checkEngineLock();
  const types = {
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webp": "image/webp",
    ".ttf": "font/ttf"
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let bytes, type;
      if (url.pathname === "/") {
        bytes = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><canvas id="c" width="1280" height="720"></canvas><script src="/film.js"></script><script>const c=document.getElementById('c');window.ready=YunipalsFilm.loadAssets('/assets/');window.frameAt=(t,png=false)=>{YunipalsFilm.drawFrame(c.getContext('2d'),t);return c.toDataURL(png?'image/png':'image/jpeg',0.94);};</script></body></html>`;
        type = "text/html; charset=utf-8";
      } else if (url.pathname === "/film.js") {
        bytes = await readFile(join(root, "src/film.js"));
        type = types[".js"];
      } else {
        const match = /^\/assets\/([A-Za-z0-9_.-]+)$/.exec(url.pathname);
        if (!match || match[1].includes("..")) throw new Error();
        bytes = await readFile(join(job, "assets", match[1]));
        type = types[extname(match[1])] ?? "application/octet-stream";
      }
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let browser;
  try {
    if (!process.env.ANIME_CHROME)
      throw new Error("Pinned ANIME_CHROME is required");
    browser = await chromium.launch({
      executablePath: process.env.ANIME_CHROME,
      args: ["--disable-gpu", "--no-sandbox"],
      headless: true
    });
    if (browser.version() !== lock.chromium)
      throw new Error("Chromium version differs from engine lock");
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      locale: "en-US",
      timezoneId: "UTC",
      deviceScaleFactor: 1
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => window.ready);
    const info = await page.evaluate(() => ({
      duration: YunipalsFilm.DURATION,
      cues: YunipalsFilm.CUES,
      chapters: YunipalsFilm.CHAPTERS
    }));
    const frame = async (t, png = false) =>
      Buffer.from(
        (
          await page.evaluate(([t, png]) => window.frameAt(t, png), [t, png])
        ).split(",")[1],
        "base64"
      );
    const result = await callback({ page, frame, info, lock });
    if (errors.length) throw new Error(`Anime renderer: ${errors.join("; ")}`);
    return result;
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
}
export async function renderFilm(job, { stillsOnly = false } = {}) {
  await mkdir(join(job, "public"), { recursive: true });
  return withFilm(job, async ({ frame, info, lock }) => {
    await writeFile(join(job, "film.cues.json"), JSON.stringify(info));
    for (const chapter of info.chapters)
      await writeFile(
        join(job, "public", chapter.id + ".png"),
        await frame(chapter.t + 1, true)
      );
    if (!stillsOnly) {
      const ff = spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "image2pipe",
          "-framerate",
          "30",
          "-c:v",
          "mjpeg",
          "-i",
          "-",
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-crf",
          "20",
          "-threads",
          "1",
          "-pix_fmt",
          "yuv420p",
          "-map_metadata",
          "-1",
          "-movflags",
          "+faststart",
          join(job, "silent.mp4")
        ],
        { stdio: ["pipe", "ignore", "inherit"] }
      );
      const done = once(ff, "close");
      ff.stdin.on("error", () => {});
      try {
        for (let i = 0; i < Math.ceil(info.duration * 30); i++) {
          if (ff.exitCode !== null) throw new Error("Anime encoder stopped");
          if (!ff.stdin.write(await frame(i / 30)))
            await once(ff.stdin, "drain");
        }
        ff.stdin.end();
        if ((await done)[0] !== 0) throw new Error("Anime encode failed");
      } catch (error) {
        ff.kill("SIGTERM");
        throw error;
      }
    }
    await writeFile(
      join(job, "render-receipt.json"),
      JSON.stringify(
        {
          engineVersion: lock.version,
          engineSha256: lock.sha256,
          chromium: lock.chromium,
          fps: 30,
          width: 1280,
          height: 720,
          ...info
        },
        null,
        2
      ) + "\n"
    );
    return info;
  });
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const job = process.argv[2];
  if (!job) throw new Error("Usage: node render.mjs JOB [--stills]");
  await renderFilm(resolve(job), {
    stillsOnly: process.argv.includes("--stills")
  });
}
