import { randomUUID } from "node:crypto";
import { updateState } from "./store.mjs";
import { createRpc, MAINNET_GENESIS } from "./rpc.mjs";
import { readReceipt } from "./receipts.mjs";
import { reconcileBatch } from "./settlements.mjs";
import { signatureValid } from "../src/domain.mjs";
const stamp = (now) => new Date(now()).toISOString();
export function event(s, stage, detail, now = Date.now) {
  s.events.unshift({ id: randomUUID(), stage, detail, at: stamp(now) });
  s.events = s.events.slice(0, 120);
}
export async function walletHistory(wallet, rpc) {
  const rows = [],
    seen = new Set();
  let before;
  for (let page = 0; page < 3; page++) {
    const batch = await rpc("getSignaturesForAddress", [
      wallet.address,
      {
        commitment: "finalized",
        limit: 60,
        ...(before ? { before } : {}),
        ...(wallet.cursor ? { until: wallet.cursor } : {}),
      },
    ]);
    if (!Array.isArray(batch)) throw Error("Wallet history unavailable.");
    let reached = false;
    for (const row of batch) {
      if (
        !signatureValid(row.signature) ||
        !Number.isSafeInteger(row.slot) ||
        row.confirmationStatus !== "finalized"
      )
        throw Error("Invalid finalized history.");
      if (row.signature === wallet.cursor || row.slot <= wallet.startSlot) {
        reached = true;
        break;
      }
      if (!seen.has(row.signature)) {
        rows.push(row);
        seen.add(row.signature);
      }
    }
    if (reached || batch.length < 60) return rows.reverse();
    const next = batch.at(-1)?.signature;
    if (!next || next === before)
      throw Error("Wallet pagination did not advance.");
    before = next;
  }
  throw Error("History coverage exceeds this cycle. Cursor was not advanced.");
}
export async function tick({
  store = updateState,
  rpc = createRpc(),
  now = Date.now,
  manual = false,
} = {}) {
  const id = randomUUID(),
    start = now(),
    bucket = Math.floor(start / 300000);
  const state = await store((s) => {
    if (s.lease?.until > start || s.lastBucket === bucket) return null;
    s.lease = { id, until: start + 90000 };
    event(s, "receive", "Reading finalized Solana state.", now);
    return s;
  });
  if (state.lease?.id !== id)
    return {
      skipped: true,
      reason: "Current cycle is already running or complete.",
    };
  const commit = (fn) =>
    store((s) => {
      if (s.lease?.id !== id || s.lease.until < now())
        throw Error("Observation lease expired.");
      fn(s);
      return s;
    });
  try {
    if ((await rpc("getGenesisHash")) !== MAINNET_GENESIS)
      throw Error("Mainnet identity mismatch.");
    const slot = await rpc("getSlot", [{ commitment: "finalized" }]);
    if (!Number.isSafeInteger(slot) || slot < 1)
      throw Error("Finalized slot unavailable.");
    await commit((s) => {
      s.network = { slot, observedAt: stamp(now), genesis: MAINNET_GENESIS };
      event(s, "verify", `Mainnet finalized slot ${slot} recorded.`, now);
    });
    // The network sample is kept separate from protocol wallets and revenue.
    try {
      const blocks = await rpc("getBlocksWithLimit", [
        slot - 8,
        1,
        { commitment: "finalized" },
      ]);
      if (
        !Array.isArray(blocks) ||
        !Number.isSafeInteger(blocks[0]) ||
        blocks[0] > slot
      )
        throw Error("Network sample block unavailable.");
      const block = await rpc("getBlock", [
        blocks[0],
        {
          commitment: "finalized",
          transactionDetails: "signatures",
          rewards: false,
          maxSupportedTransactionVersion: 1,
        },
      ]);
      const signature = block?.signatures?.[0];
      const { receipt } = await readReceipt(rpc, signature);
      if (receipt.slot !== blocks[0])
        throw Error("Network sample block mismatch.");
      await commit((s) => {
        s.sample = receipt;
        event(
          s,
          "print",
          "Public network sample verified. Not CLACK revenue.",
          now,
        );
      });
    } catch {
      await commit((s) =>
        event(
          s,
          "error",
          "Network sample unavailable; no receipt manufactured.",
          now,
        ),
      );
    }
    for (const original of state.wallets.filter((w) => w.enabled)) {
      const w = structuredClone(original);
      try {
        const balance = await rpc("getBalance", [
          w.address,
          { commitment: "finalized" },
        ]);
        if (
          !Number.isSafeInteger(balance?.value) ||
          !Number.isSafeInteger(balance.context?.slot) ||
          balance.context.slot < (w.balanceSlot || 0)
        )
          throw Error("Balance unavailable.");
        w.balance = String(balance.value);
        w.balanceSlot = balance.context.slot;
        w.checkedAt = stamp(now);
        const rows = await walletHistory(w, rpc),
          receipts = [];
        for (const row of rows.slice(0, 3)) {
          const { receipt } = await readReceipt(rpc, row.signature);
          if (
            receipt.slot !== row.slot ||
            !receipt.accounts.some((a) => a.address === w.address)
          )
            throw Error("Wallet reference mismatch.");
          receipts.push({ ...receipt, wallet: w.address, role: w.role });
          w.cursor = row.signature;
        }
        w.error = null;
        w.status = rows.length > 3 ? "catching-up" : "observing";
        await commit((s) => {
          const i = s.wallets.findIndex(
            (x) => x.id === w.id && x.revision === w.revision,
          );
          if (i < 0) return;
          s.wallets[i] = w;
          for (const r of receipts)
            if (
              !s.receipts.some(
                (x) => x.signature === r.signature && x.wallet === r.wallet,
              )
            )
              s.receipts.unshift(r);
          s.receipts = s.receipts.slice(0, 120);
          event(
            s,
            "print",
            `${w.label}: ${receipts.length} new finalized records.`,
            now,
          );
        });
      } catch {
        await commit((s) => {
          const current = s.wallets.find(
            (x) => x.id === w.id && x.revision === w.revision,
          );
          if (current) {
            current.error =
              "Observation unavailable. Previous balance retained; cursor unchanged.";
            current.status = "unavailable";
          }
          event(s, "error", `${w.label}: observation incomplete.`, now);
        });
      }
    }
    for (const batch of state.batches
      .filter((b) => b.status === "submitted")
      .slice(0, 3)) {
      try {
        const result = await reconcileBatch(batch, rpc);
        await commit((s) => {
          const i = s.batches.findIndex(
            (b) =>
              b.id === batch.id &&
              b.signature === batch.signature &&
              b.status === "submitted",
          );
          if (i >= 0) {
            s.batches[i] = result;
            event(
              s,
              result.status === "finalized" ? "settle" : "error",
              `Batch ${batch.id.slice(0, 8)}: ${result.status}.`,
              now,
            );
          }
        });
      } catch {
        /* Retain the original signature for a later finalized lookup. */
      }
    }
    await commit((s) => {
      s.lastCompleted = stamp(now);
      if (!manual) s.lastScheduledCompletion = s.lastCompleted;
      s.lastBucket = bucket;
      s.cycles++;
      s.error = null;
      s.lease = null;
    });
    return { ok: true };
  } catch (error) {
    await store((s) => {
      if (s.lease?.id !== id) return null;
      s.error = "Mainnet observation unavailable.";
      s.lease = null;
      event(s, "error", s.error, now);
      return s;
    }).catch(() => {});
    throw error;
  }
}
