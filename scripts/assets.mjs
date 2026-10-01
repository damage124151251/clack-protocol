import { chromium } from "playwright";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url),
  film = process.argv.includes("--film"),
  ffmpeg = process.env.FFMPEG_PATH;
if (film && !ffmpeg) throw Error("Set FFMPEG_PATH to generate video files.");
for (const dir of ["public/brand/", "marketing/", "artifacts/film/"])
  await mkdir(new URL(dir, root), { recursive: true });
const browser = await chromium.launch(),
  page = await browser.newPage();
try {
  await page.goto("http://127.0.0.1:5251");
  await page.evaluate(async () => {
    await document.fonts.load("60px Silkscreen");
    await document.fonts.load('16px "IBM Plex Mono"');
  });
  async function render(kind, w, h, time = 6.7, scene = 0) {
    const data = await page.evaluate(
      async ({ kind, w, h, time, scene }) => {
        const { drawBrand, drawFilm } = await import("/src/art.mjs"),
          canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const c = canvas.getContext("2d");
        c.imageSmoothingEnabled = false;
        if (kind === "film") drawFilm(c, w, h, time, scene);
        else drawBrand(c, w, h, kind);
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { kind, w, h, time, scene },
    );
    return Buffer.from(data, "base64");
  }
  for (const [name, type, w, h] of [
    ["logo", "logo", 1024, 1024],
    ["transparent", "transparent", 1024, 1024],
    ["avatar", "avatar", 1024, 1024],
    ["mark", "transparent", 128, 128],
    ["banner", "banner", 1500, 500],
  ]) {
    const file = `clack-${name}.png`;
    await writeFile(
      new URL("public/brand/" + file, root),
      await render(type, w, h),
    );
    await copyFile(
      new URL("public/brand/" + file, root),
      new URL("marketing/" + file, root),
    );
  }
  for (let scene = 0; scene < 3; scene++) {
    await writeFile(
      new URL(`marketing/post-0${scene + 1}.png`, root),
      await render("film", 1600, 900, 6.7, scene),
    );
    if (!film) continue;
    const dir = new URL(`artifacts/film/${scene}/`, root);
    await mkdir(dir, { recursive: true });
    for (let f = 0; f < 240; f++)
      await writeFile(
        new URL(String(f).padStart(4, "0") + ".png", dir),
        await render("film", 1280, 720, f / 30, scene),
      );
    await new Promise((resolve, reject) => {
      const p = spawn(
        ffmpeg,
        [
          "-y",
          "-framerate",
          "30",
          "-i",
          fileURLToPath(dir) + "%04d.png",
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "18",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          "-t",
          "8",
          fileURLToPath(new URL(`marketing/post-0${scene + 1}.mp4`, root)),
        ],
        { windowsHide: true, stdio: "ignore" },
      );
      p.on("error", reject);
      p.on("exit", (code) =>
        code === 0 ? resolve() : reject(Error("Video encoding failed.")),
      );
    });
    console.log(`Video ${scene + 1}: 8 seconds / 1280x720 / 30fps`);
  }
  console.log("CLACK brand assets generated.");
} finally {
  await browser.close();
}
