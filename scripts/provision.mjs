import { readFile } from "node:fs/promises";
import { PROTOCOL_WALLETS, DEV_WALLET } from "../src/config.mjs";
const base = process.env.CLACK_URL || "http://127.0.0.1:5251";
const local = new URL(base).hostname === "127.0.0.1";
if (!local && base !== "https://clack-protocol.vercel.app")
  throw Error("Unexpected provisioning destination.");
const { operator } = JSON.parse(
  await readFile(
    new URL(
      local ? "../.local/dev-access.json" : "../.local/operator.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
async function request(path, body) {
  const r = await fetch(base + path, {
    signal: AbortSignal.timeout(59000),
    ...(body
      ? {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${operator}`,
          },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await r.json();
  if (!r.ok) throw Error(`${r.status}: ${data.error}`);
  return data;
}
let status = await request("/api/status");
for (const w of PROTOCOL_WALLETS) {
  const existing = status.wallets.find(
    (x) => x.role === w.role || x.address === w.address,
  );
  if (existing && (existing.role !== w.role || existing.address !== w.address))
    throw Error(`Conflicting wallet for ${w.role}; no overwrite performed.`);
  if (!existing) await request("/api/operator", { action: "add-wallet", ...w });
  console.log(`${w.role}: registered`);
}
if (status.identity.wallet && status.identity.wallet !== DEV_WALLET)
  throw Error("Conflicting developer identity; no overwrite performed.");
if (!status.identity.wallet)
  await request("/api/operator", { action: "set-wallet", wallet: DEV_WALLET });
console.log("Developer watcher activated.");
for (const action of ["watch", "run"]) {
  try {
    console.log(action, await request("/api/operator", { action }));
  } catch (e) {
    console.log(`${action}: ${e.message}; scheduled retry remains available.`);
  }
}
status = await request("/api/status");
console.log(
  JSON.stringify(
    {
      wallets: status.wallets.map(
        ({ role, address, balance, status, error }) => ({
          role,
          address,
          balance,
          status,
          error,
        }),
      ),
      receipts: status.receipts.length,
      ca: status.identity.tokenCA,
      watcher: status.identity.watchStatus,
    },
    null,
    2,
  ),
);
