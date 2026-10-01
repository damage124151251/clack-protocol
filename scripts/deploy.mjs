import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url),
  token = process.env.VERCEL_TOKEN;
if (!token || !/^[A-Za-z0-9_-]+$/.test(token))
  throw new Error("Set VERCEL_TOKEN in the process environment.");
const team = process.env.VERCEL_TEAM_ID,
  scope = process.env.VERCEL_SCOPE,
  name = "clack-protocol";
if (!team || !scope)
  throw new Error(
    "Set VERCEL_TEAM_ID and VERCEL_SCOPE for the intended deployment account.",
  );
async function api(path, method = "GET", body) {
  const r = await fetch(
    `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${team}`,
    {
      method,
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const raw = await r.text();
  return { status: r.status, data: raw ? JSON.parse(raw) : {} };
}
async function checked(path, method, body) {
  const r = await api(path, method, body);
  if (r.status >= 400)
    throw new Error(
      `Vercel request failed: ${r.status} ${r.data.error?.code || ""}`,
    );
  return r.data;
}
const account = await checked(`/v2/teams/${team}`);
if (!["pro", "enterprise"].includes(account.billing?.plan))
  throw new Error(
    "Scheduled agents require an existing Pro plan. No plan change made.",
  );
let link;
try {
  link = JSON.parse(
    await readFile(new URL(".vercel/project.json", root), "utf8"),
  );
} catch {}
if (!link) {
  const existing = await api(`/v9/projects/${name}`);
  if (existing.status !== 404)
    throw new Error("Refusing to take over an existing project.");
  const p = await checked("/v10/projects", "POST", {
    name,
    framework: "vite",
    buildCommand: "npm run build",
    outputDirectory: "dist",
  });
  link = { projectId: p.id, orgId: team, projectName: name };
  await mkdir(new URL(".vercel/", root), { recursive: true });
  await writeFile(
    new URL(".vercel/project.json", root),
    JSON.stringify(link, null, 2),
  );
  await checked(`/v9/projects/${p.id}`, "PATCH", {
    ssoProtection: null,
    nodeVersion: "24.x",
  });
}
if (link.orgId !== team || link.projectName !== name)
  throw new Error("Unexpected project link.");
const domains = await checked(`/v9/projects/${link.projectId}/domains`),
  host = domains.domains?.find((d) => d.name === `${name}.vercel.app`)?.name;
if (!host) throw new Error("Unexpected default domain.");
let secrets;
try {
  secrets = JSON.parse(
    await readFile(new URL(".local/operator.json", root), "utf8"),
  );
} catch {
  secrets = {
    operator: randomBytes(32).toString("base64url"),
    cron: randomBytes(32).toString("base64url"),
  };
  await mkdir(new URL(".local/", root), { recursive: true });
  await writeFile(
    new URL(".local/operator.json", root),
    JSON.stringify(secrets),
    { mode: 0o600, flag: "wx" },
  );
}
const env = await checked(`/v10/projects/${link.projectId}/env`);
for (const [key, value] of Object.entries({
  PUBLIC_ORIGIN: `https://${host}`,
  CLACK_OPERATOR_KEY: secrets.operator,
  CRON_SECRET: secrets.cron,
})) {
  if (!env.envs.some((e) => e.key === key && e.target.includes("production")))
    await checked(`/v10/projects/${link.projectId}/env`, "POST", {
      key,
      value,
      type: "encrypted",
      target: ["production"],
    });
}
let storage;
try {
  storage = JSON.parse(
    await readFile(new URL(".vercel/store.json", root), "utf8"),
  );
} catch {}
if (!storage) {
  const r = await checked("/v1/storage/stores/blob", "POST", {
    name: "clack-records",
    region: "iad1",
    access: "private",
  });
  storage = { id: r.store.id, access: r.store.access };
  await writeFile(new URL(".vercel/store.json", root), JSON.stringify(storage));
}
if (storage.access !== "private")
  throw new Error("Ledger storage must be private.");
if (
  !env.envs.some(
    (e) => e.key === "BLOB_READ_WRITE_TOKEN" && e.target.includes("production"),
  )
)
  await checked(`/v1/storage/stores/${storage.id}/connections`, "POST", {
    projectId: link.projectId,
    envVarEnvironments: ["production"],
    type: "integration",
  });
await writeFile(
  new URL("operator-access.txt", root),
  `CLACK operator access. PRIVATE: do not publish.\nSite: https://${host}\nOperator key: ${secrets.operator}\nUnlock via Operator in the footer. Controls public wallet monitoring, settlement preparation and the token watcher.\nPayments require the distribution wallet to sign the exact transaction.\nRotate CLACK_OPERATOR_KEY in Vercel to revoke access.\n`,
  { mode: 0o600 },
);
console.log("Deploying CLACK with private storage and scheduled agents.");
await new Promise((yes, no) => {
  const child = spawn(
    "vercel.cmd",
    ["--prod", "--yes", "--scope", scope, "--token", token],
    {
      cwd: fileURLToPath(root),
      shell: true,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: "1" },
    },
  );
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (d) =>
      process.stdout.write(d.toString().replaceAll(token, "[redacted]")),
    );
  child.on("error", no);
  child.on("exit", (c) =>
    c === 0 ? yes() : no(new Error(`Deploy failed (${c}).`)),
  );
});
await writeFile(
  new URL("deployment.json", root),
  JSON.stringify(
    {
      projectId: link.projectId,
      domain: host,
      deployedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(`Production: https://${host}`);
