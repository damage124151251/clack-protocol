import { timingSafeEqual, randomUUID } from "node:crypto";
import { readState, updateState } from "./store.mjs";
import { createRpc, MAINNET_GENESIS } from "./rpc.mjs";
import { watchLaunch } from "./launch.mjs";
import { tick, event } from "./worker.mjs";
import { readReceipt } from "./receipts.mjs";
import {
  createBatch,
  prepareBatch,
  validateSigned,
  reconcileBatch,
  publicBatch,
} from "./settlements.mjs";
import { addressValid, signatureValid } from "../src/domain.mjs";
import { ROLES, TOKEN_CA, X_URL, GITHUB_URL } from "../src/config.mjs";
export function authorized(req, secret) {
  const a = req.headers.authorization || "",
    b = `Bearer ${secret}`;
  return (
    typeof secret === "string" &&
    secret.length >= 32 &&
    typeof a === "string" &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
const json = (res, status, data) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
};
const cache = new Map();
async function inputBody(req) {
  if (req.body && typeof req.body === "object") {
    if (Buffer.byteLength(JSON.stringify(req.body)) > 12000)
      throw Error("Invalid request size.");
    return req.body;
  }
  let raw = "";
  for await (const part of req) {
    raw += part;
    if (Buffer.byteLength(raw) > 12000) throw Error("Invalid request size.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw Error("Invalid request JSON.");
  }
}
async function mainnet() {
  const rpc = createRpc();
  if ((await rpc("getGenesisHash")) !== MAINNET_GENESIS)
    throw Error("Mainnet identity mismatch.");
  return rpc;
}
export async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost"),
      path = url.pathname;
    if (path === "/api/health" && req.method === "GET")
      return json(res, 200, {
        ok: true,
        service: "CLACK",
        mode: "receipts-and-signed-SOL-settlements",
      });
    if (path === "/api/status" && req.method === "GET") {
      const { data: s } = await readState(),
        ca = TOKEN_CA || s.launchState?.pinned?.mint || null;
      return json(res, 200, {
        serverTime: new Date().toISOString(),
        wallets: s.wallets,
        receipts: s.receipts,
        sample: s.sample || null,
        batches: s.batches.map(publicBatch),
        events: s.events,
        network: s.network,
        error: s.error,
        running: s.lease?.until > Date.now(),
        cycles: s.cycles,
        lastCompleted: s.lastCompleted,
        lastScheduledCompletion: s.lastScheduledCompletion,
        scheduler: {
          minutes: 5,
          configured: !!process.env.VERCEL && !!process.env.CRON_SECRET,
        },
        identity: {
          wallet: s.identitySettings?.wallet || null,
          tokenCA: ca,
          proof:
            s.launchState?.pinned?.mint === ca ? s.launchState.pinned : null,
          watchStatus: s.watchStatus,
          checkedAt: s.watchAt || null,
          github: GITHUB_URL,
          x: X_URL,
        },
      });
    }
    if (path === "/api/receipt" && req.method === "GET") {
      const signature = url.searchParams.get("signature");
      if (!signatureValid(signature))
        throw Error("Invalid Solana transaction signature.");
      const known = cache.get(signature);
      if (known && known.until > Date.now())
        return json(res, 200, known.receipt);
      const rpc = await mainnet(),
        { receipt } = await readReceipt(rpc, signature);
      cache.set(signature, { receipt, until: Date.now() + 60000 });
      if (cache.size > 64) cache.delete(cache.keys().next().value);
      return json(res, 200, receipt);
    }
    if (["/api/tick", "/api/watch"].includes(path) && req.method === "GET") {
      if (!authorized(req, process.env.CRON_SECRET))
        return json(res, 401, { error: "Scheduler authorization required." });
      return json(
        res,
        200,
        path === "/api/tick" ? await tick() : await watchLaunch(),
      );
    }
    if (path !== "/api/operator")
      return json(res, 404, { error: "Not found." });
    if (!authorized(req, process.env.CLACK_OPERATOR_KEY))
      return json(res, 401, { error: "Operator access required." });
    if (req.method === "GET") return json(res, 200, { authorized: true });
    if (req.method !== "POST")
      return json(res, 405, { error: "Method not allowed." });
    const origins = (
      process.env.PUBLIC_ORIGINS ||
      process.env.PUBLIC_ORIGIN ||
      "http://127.0.0.1:5251"
    )
      .split(",")
      .map((s) => s.trim());
    if (req.headers.origin && !origins.includes(req.headers.origin))
      return json(res, 403, { error: "Origin rejected." });
    const input = await inputBody(req);
    if (input.action === "run")
      return json(res, 200, await tick({ manual: true }));
    if (input.action === "watch") return json(res, 200, await watchLaunch());
    if (input.action === "set-wallet") {
      if (!addressValid(input.wallet))
        throw Error("Invalid public developer wallet.");
      const rpc = await mainnet(),
        startSlot = await rpc("getSlot", [{ commitment: "finalized" }]);
      if (!Number.isSafeInteger(startSlot) || startSlot < 1)
        throw Error("Finalized slot unavailable.");
      await updateState((s) => {
        if (s.identitySettings?.wallet === input.wallet) return null;
        s.identitySettings = { wallet: input.wallet, startSlot };
        s.launchState = null;
        s.watchLease = null;
        s.watchBucket = null;
        s.watchStatus = "watching";
        s.watchAt = null;
        return s;
      });
      return json(res, 200, { ok: true });
    }
    if (input.action === "add-wallet") {
      if (
        !addressValid(input.address) ||
        !ROLES.some((r) => r.id === input.role)
      )
        throw Error("Invalid wallet or role.");
      const rpc = await mainnet(),
        b = await rpc("getBalance", [
          input.address,
          { commitment: "finalized" },
        ]);
      if (
        !Number.isSafeInteger(b?.context?.slot) ||
        !Number.isSafeInteger(b.value)
      )
        throw Error("Wallet baseline unavailable.");
      const imported = [];
      try {
        const recent = await rpc("getSignaturesForAddress", [
          input.address,
          { commitment: "finalized", limit: 2 },
        ]);
        for (const row of recent) {
          if (row.slot > b.context.slot) continue;
          const { receipt } = await readReceipt(rpc, row.signature);
          if (receipt.accounts.some((a) => a.address === input.address))
            imported.push({
              ...receipt,
              wallet: input.address,
              role: input.role,
              imported: true,
            });
        }
      } catch {
        /* A historical import is optional; the finalized activation boundary is not. */
      }
      await updateState((s) => {
        if (
          s.wallets.length >= 5 ||
          s.wallets.some(
            (w) => w.role === input.role || w.address === input.address,
          )
        )
          throw Error("Invalid duplicate wallet or role. Maximum 5 wallets.");
        s.wallets.push({
          id: randomUUID(),
          revision: 1,
          role: input.role,
          label: ROLES.find((r) => r.id === input.role).label,
          address: input.address,
          balance: String(b.value),
          balanceSlot: b.context.slot,
          startSlot: b.context.slot,
          checkedAt: new Date().toISOString(),
          enabled: true,
          cursor: null,
          status: "observing",
          error: null,
        });
        s.receipts.unshift(...imported);
        s.receipts = s.receipts.slice(0, 120);
        event(
          s,
          "receive",
          `${input.role} wallet activated at finalized slot ${b.context.slot}.`,
        );
        return s;
      });
      return json(res, 201, { ok: true });
    }
    if (input.action === "toggle-wallet") {
      if (typeof input.enabled !== "boolean")
        throw Error("Invalid enabled state.");
      await updateState((s) => {
        const w = s.wallets.find((w) => w.id === input.id);
        if (!w) throw Error("Invalid wallet.");
        w.enabled = input.enabled;
        w.revision++;
        return s;
      });
      return json(res, 200, { ok: true });
    }
    if (input.action === "create-batch") {
      const batch = createBatch(input);
      await updateState((s) => {
        if (
          !s.wallets.some(
            (w) =>
              w.enabled &&
              w.address === batch.payer &&
              w.role === "distribution",
          )
        )
          throw Error(
            "Invalid payer: configure the distribution wallet first.",
          );
        if (s.batches.length >= 100)
          throw Error(
            "Invalid batch capacity: export records and contact the operator.",
          );
        s.batches.unshift(batch);
        event(
          s,
          "allocate",
          `Batch ${batch.id.slice(0, 8)} recorded; awaiting treasury signature.`,
        );
        return s;
      });
      return json(res, 201, { batch: publicBatch(batch) });
    }
    if (input.action === "prepare-batch") {
      const lease = randomUUID();
      let batch;
      await updateState((s) => {
        const b = s.batches.find((b) => b.id === input.id);
        if (!b || b.status !== "draft" || b.prepareLease?.until > Date.now())
          throw Error("Invalid batch state. Recover the existing preparation.");
        b.prepareLease = { id: lease, until: Date.now() + 60000 };
        batch = structuredClone(b);
        return s;
      });
      try {
        const ready = await prepareBatch(batch, await mainnet());
        await updateState((s) => {
          const i = s.batches.findIndex(
            (b) =>
              b.id === input.id &&
              b.prepareLease?.id === lease &&
              b.status === "draft",
          );
          if (i < 0 || s.batches[i].prepareLease.until < Date.now())
            throw Error("Preparation lease expired.");
          delete ready.prepareLease;
          s.batches[i] = ready;
          return s;
        });
        return json(res, 200, {
          batch: publicBatch(ready),
          unsigned: ready.unsigned,
        });
      } catch (error) {
        await updateState((s) => {
          const b = s.batches.find(
            (b) => b.id === input.id && b.prepareLease?.id === lease,
          );
          if (!b) return null;
          delete b.prepareLease;
          return s;
        });
        throw error;
      }
    }
    if (input.action === "recover-batch") {
      const { data } = await readState(),
        b = data.batches.find((b) => b.id === input.id);
      if (!b) throw Error("Invalid batch.");
      return json(res, 200, {
        batch: publicBatch(b),
        unsigned: b.status === "prepared" ? b.unsigned : null,
      });
    }
    if (input.action === "submit-batch") {
      let batch;
      await updateState((s) => {
        const b = s.batches.find((b) => b.id === input.id);
        if (!b) throw Error("Invalid batch.");
        const signature = validateSigned(b, input.signed);
        b.signature = signature;
        b.signed = input.signed;
        b.status = "submitted";
        b.submittedAt ||= new Date().toISOString();
        batch = structuredClone(b);
        return s;
      });
      // The signature is durable before sending. An uncertain response never starts a new payment.
      try {
        const rpc = await mainnet();
        const sent = await rpc("sendTransaction", [
          batch.signed,
          {
            encoding: "base64",
            skipPreflight: false,
            preflightCommitment: "finalized",
            maxRetries: 2,
          },
        ]);
        if (sent !== batch.signature)
          throw Error("Submission signature mismatch.");
      } catch {
        return json(res, 202, {
          batch: publicBatch(batch),
          pending: true,
          message:
            "Submission uncertain. Retain this exact signature; do not create another batch.",
        });
      }
      return json(res, 202, { batch: publicBatch(batch), pending: true });
    }
    if (input.action === "check-batch") {
      const { data } = await readState(),
        b = data.batches.find((b) => b.id === input.id);
      if (!b) throw Error("Invalid batch.");
      const result = await reconcileBatch(b, await mainnet());
      await updateState((s) => {
        const i = s.batches.findIndex(
          (x) =>
            x.id === b.id &&
            x.status === b.status &&
            x.signature === b.signature,
        );
        if (i < 0) return null;
        s.batches[i] = result;
        return s;
      });
      return json(res, 200, { batch: publicBatch(result) });
    }
    throw Error("Invalid operation.");
  } catch (error) {
    const safe =
      /^(Invalid |Enter |Amount |Choose |Recipients |Allocations |This batch|Recover |Transaction is not finalized|Finalized transaction not available|Treasury balance|Network fee estimate|Signed transaction)/.test(
        error.message,
      );
    return json(res, safe ? 400 : 503, {
      error: safe
        ? error.message
        : "Operation unavailable. Existing records and submitted signatures are preserved.",
    });
  }
}
