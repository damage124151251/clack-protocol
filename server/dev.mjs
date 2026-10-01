import { createServer } from "node:http";
import { createServer as createVite } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
let keys;
try {
  keys = JSON.parse(
    await readFile(
      new URL("../.local/dev-access.json", import.meta.url),
      "utf8",
    ),
  );
} catch {
  keys = {
    operator: randomBytes(32).toString("base64url"),
    cron: randomBytes(32).toString("base64url"),
  };
  await writeFile(
    new URL("../.local/dev-access.json", import.meta.url),
    JSON.stringify(keys),
    { mode: 0o600, flag: "wx" },
  );
}
process.env.CLACK_OPERATOR_KEY ||= keys.operator;
process.env.CRON_SECRET ||= keys.cron;
const { handler } = await import("./http.mjs"),
  vite = await createVite({ server: { middlewareMode: true } });
createServer((req, res) =>
  req.url.startsWith("/api/") ? handler(req, res) : vite.middlewares(req, res),
).listen(5251, "127.0.0.1", () =>
  console.log(
    "CLACK: http://127.0.0.1:5251\nPrivate local credential: .local/dev-access.json",
  ),
);
