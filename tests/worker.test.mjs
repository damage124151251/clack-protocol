import test from "node:test";
import assert from "node:assert/strict";
import bs58 from "bs58";
import { tick, walletHistory } from "../server/worker.mjs";
import { initialState } from "../server/config.mjs";
import { MAINNET_GENESIS } from "../server/rpc.mjs";
import { PROTOCOL_WALLETS } from "../src/config.mjs";
const signature = (n) =>
  bs58.encode(Uint8Array.from({ length: 64 }, (_, i) => (n + i) % 256));
const row = (n) => ({
  signature: signature(n),
  slot: n,
  confirmationStatus: "finalized",
  err: null,
});
function memory(seed = {}) {
  let s = { ...initialState(), ...seed };
  return {
    get: () => structuredClone(s),
    store: async (fn) => {
      const next = await fn(structuredClone(s));
      if (next) s = next;
      return structuredClone(s);
    },
  };
}
const now = () => 3000000;
const wallet = () => ({
  ...PROTOCOL_WALLETS[0],
  id: "w1",
  label: "Intake",
  revision: 1,
  enabled: true,
  balance: "500",
  balanceSlot: 100,
  startSlot: 100,
  cursor: null,
});
const rpc = async (method) => {
  if (method === "getGenesisHash") return MAINNET_GENESIS;
  if (method === "getSlot") return 200;
  if (method === "getBlocksWithLimit") throw Error("Unavailable sample");
  if (method === "getBalance") return { value: 500, context: { slot: 200 } };
  if (method === "getSignaturesForAddress") return [];
  throw Error("Unexpected RPC");
};
test("history processes oldest first, stops at activation and deduplicates", async () => {
  const rows = await walletHistory(wallet(), async () => [
    row(103),
    row(103),
    row(102),
    row(100),
  ]);
  assert.deepEqual(
    rows.map((r) => r.slot),
    [102, 103],
  );
});
test("history rejects unfinalized rows and bounded history overflow", async () => {
  await assert.rejects(
    walletHistory(wallet(), async () => [
      { ...row(103), confirmationStatus: "confirmed" },
    ]),
  );
  let page = 0;
  await assert.rejects(
    walletHistory({ ...wallet(), startSlot: 0 }, async () =>
      Array.from({ length: 60 }, (_, i) => row(240 - (page * 60 + i))).map(
        (r, i, a) => {
          if (i === a.length - 1) page++;
          return r;
        },
      ),
    ),
    /coverage/,
  );
});
test("manual cycle observes wallets but does not fabricate cron completion or receipts", async () => {
  const db = memory({ wallets: [wallet()] });
  await tick({ store: db.store, rpc, now, manual: true });
  const s = db.get();
  assert.equal(s.cycles, 1);
  assert.equal(s.lastScheduledCompletion, null);
  assert.equal(s.wallets[0].balanceSlot, 200);
  assert.equal(s.receipts.length, 0);
  assert.equal(s.lease, null);
});
test("leases and completed buckets prevent duplicate concurrent cycles", async () => {
  const active = memory({ lease: { id: "other", until: now() + 1 } });
  assert.equal((await tick({ store: active.store, rpc, now })).skipped, true);
  const complete = memory({ lastBucket: Math.floor(now() / 300000) });
  assert.equal((await tick({ store: complete.store, rpc, now })).skipped, true);
});
test("scheduled completion is recorded only for a completed authenticated-cycle path", async () => {
  const db = memory();
  await tick({ store: db.store, rpc, now });
  assert.equal(db.get().lastScheduledCompletion, new Date(now()).toISOString());
});
test("a failed wallet read preserves the last balance and checkpoint", async () => {
  const w = { ...wallet(), cursor: signature(102) },
    db = memory({ wallets: [w] });
  await tick({
    store: db.store,
    rpc: async (m) =>
      m === "getSignaturesForAddress"
        ? Promise.reject(Error("offline"))
        : rpc(m),
    now,
  });
  const result = db.get().wallets[0];
  assert.equal(result.balanceSlot, 100);
  assert.equal(result.cursor, w.cursor);
  assert.equal(result.status, "unavailable");
  assert.match(result.error, /unchanged/);
});
test("changed wallet revisions cannot be overwritten by a running cycle", async () => {
  const db = memory({ wallets: [wallet()] });
  await tick({
    store: db.store,
    rpc: async (m) => {
      if (m === "getBalance")
        await db.store((s) => {
          s.wallets[0].revision++;
          s.wallets[0].enabled = false;
          return s;
        });
      return rpc(m);
    },
    now,
  });
  assert.equal(db.get().wallets[0].balanceSlot, 100);
  assert.equal(db.get().wallets[0].enabled, false);
});
test("wrong-chain observations never create a successful cycle", async () => {
  const db = memory();
  await assert.rejects(
    tick({ store: db.store, rpc: async () => "devnet", now }),
  );
  assert.equal(db.get().cycles, 0);
  assert.equal(db.get().network, null);
  assert.equal(db.get().lease, null);
});
