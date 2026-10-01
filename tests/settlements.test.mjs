import test from "node:test";
import assert from "node:assert/strict";
import bs58 from "bs58";
import { Keypair, Transaction } from "@solana/web3.js";
import {
  solToLamports,
  sol,
  allocations,
  addressValid,
  signatureValid,
  receiptText,
} from "../src/domain.mjs";
import {
  createBatch,
  prepareBatch,
  validateSigned,
  publicBatch,
  reconcileBatch,
} from "../server/settlements.mjs";
import {
  decodeReceipt,
  readReceipt,
  verifySettlement,
  SYSTEM,
  MEMO,
} from "../server/receipts.mjs";
const key = (n) => Keypair.fromSeed(new Uint8Array(32).fill(n));
const payer = key(1),
  address = (n) => key(n).publicKey.toBase58(),
  sig = (n) => bs58.encode(new Uint8Array(64).fill(n));
function draft() {
  return createBatch({
    payer: address(1),
    amount: "0.010000001",
    rows: [
      { address: address(2), bps: 6000 },
      { address: address(3), bps: 4000 },
    ],
    note: "Test only",
  });
}
function chain(batch, signature = sig(1)) {
  batch.signature = signature;
  const amounts = batch.rows.map((r) => Number(r.lamports));
  return {
    slot: 1234,
    blockTime: 1790821264,
    version: "legacy",
    meta: {
      err: null,
      fee: 5000,
      innerInstructions: [],
      preBalances: [1000000000, 0, 0],
      postBalances: [
        1000000000 - amounts.reduce((n, a) => n + a, 0) - 5000,
        ...amounts,
      ],
    },
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [1, 2, 3].map((n) => ({
          pubkey: address(n),
          signer: n === 1,
          writable: true,
        })),
        instructions: [
          ...batch.rows.map((r) => ({
            programId: SYSTEM,
            parsed: {
              type: "transfer",
              info: {
                source: batch.payer,
                destination: r.address,
                lamports: Number(r.lamports),
              },
            },
          })),
          { programId: MEMO, parsed: `CLACK:${batch.id}` },
        ],
      },
    },
  };
}
const preparationRpc = async (method) =>
  ({
    getLatestBlockhash: {
      value: { blockhash: address(8), lastValidBlockHeight: 999 },
    },
    getFeeForMessage: { value: 5000 },
    getBalance: { value: 1000000000 },
  })[method];
test("exact decimal conversion never passes through floating-point arithmetic", () => {
  assert.equal(solToLamports("0.000000001"), "1");
  assert.equal(solToLamports("100000"), "100000000000000");
  assert.equal(sol("-1234567891", 9), "-1.234567891");
  for (const v of [
    0.1,
    "0",
    "-1",
    "01",
    "1e-9",
    "0.0000000001",
    "100001",
    "NaN",
    " 1",
  ])
    assert.throws(() => solToLamports(v));
});
test("address and signature schemas validate decoded length", () => {
  assert.ok(addressValid(address(1)));
  assert.ok(signatureValid(sig(1)));
  assert.equal(addressValid(sig(1)), false);
  assert.equal(signatureValid(address(1)), false);
});
test("largest remainders allocate every lamport deterministically", () => {
  const rows = [2, 3, 4].map((n, i) => ({
    address: address(n),
    bps: [3333, 3333, 3334][i],
  }));
  assert.deepEqual(
    allocations("0.000000010", rows, address(1)).map((r) => r.lamports),
    ["3", "3", "4"],
  );
  const ties = [2, 3].map((n) => ({ address: address(n), bps: 5000 }));
  assert.deepEqual(
    allocations("0.000000003", ties).map((r) => r.lamports),
    ["2", "1"],
  );
  for (let i = 10; i < 500; i++)
    assert.equal(
      allocations(`0.${String(i).padStart(9, "0")}`, rows).reduce(
        (n, r) => n + BigInt(r.lamports),
        0n,
      ),
      BigInt(i),
    );
});
test("invalid splits, self payments, duplicates and zero-rounded recipients are rejected", () => {
  const row = { address: address(2), bps: 10000 };
  for (const rows of [
    [],
    [row, row],
    [{ ...row, address: address(1) }],
    [{ ...row, bps: 9999 }],
    [{ ...row, bps: 0.5 }],
    [{ ...row, address: "bad" }],
    Array(6).fill(row),
  ])
    assert.throws(() => allocations("1", rows, address(1)));
  assert.throws(() =>
    allocations("0.000000001", [
      { ...row, bps: 5000 },
      { address: address(3), bps: 5000 },
    ]),
  );
});
test("preparation serializes exact transfers and one unique memo, without a signature", async () => {
  const b = await prepareBatch(draft(), preparationRpc),
    tx = Transaction.from(Buffer.from(b.unsigned, "base64"));
  assert.equal(b.status, "prepared");
  assert.equal(tx.signature, null);
  assert.equal(tx.instructions.length, 3);
  assert.equal(tx.feePayer.toBase58(), address(1));
  assert.equal(tx.instructions.at(-1).data.toString(), `CLACK:${b.id}`);
  assert.equal(b.feeEstimate, "5000");
});
test("preparation refuses insufficient balance, unavailable fees and re-preparation", async () => {
  await assert.rejects(
    prepareBatch(draft(), async (m) =>
      m === "getBalance" ? { value: 0 } : preparationRpc(m),
    ),
    /Treasury balance/,
  );
  await assert.rejects(
    prepareBatch(draft(), async (m) =>
      m === "getFeeForMessage" ? { value: null } : preparationRpc(m),
    ),
    /fee estimate/,
  );
  await assert.rejects(
    prepareBatch({ ...draft(), status: "prepared" }, preparationRpc),
    /already/,
  );
});
test("only a valid signature over the prepared message is accepted; retries keep the same signature", async () => {
  const b = await prepareBatch(draft(), preparationRpc),
    tx = Transaction.from(Buffer.from(b.unsigned, "base64"));
  assert.throws(() => validateSigned(b, b.unsigned));
  tx.sign(payer);
  const encoded = tx.serialize().toString("base64"),
    signature = validateSigned(b, encoded);
  assert.equal(signature, bs58.encode(tx.signature));
  assert.equal(
    validateSigned({ ...b, status: "submitted", signature }, encoded),
    signature,
  );
  assert.throws(
    () => validateSigned({ ...b, signature: sig(2) }, encoded),
    /original/,
  );
  tx.instructions[0].data[4] ^= 1;
  tx.sign(payer);
  assert.throws(
    () => validateSigned(b, tx.serialize().toString("base64")),
    /match/,
  );
});
test("the public batch never exposes serialized unsigned or signed transactions", () => {
  const b = publicBatch({
    ...draft(),
    signed: "secret",
    unsigned: "secret",
    message: "secret",
    prepareLease: {},
  });
  for (const field of ["signed", "unsigned", "message", "prepareLease"])
    assert.equal(Object.hasOwn(b, field), false);
});
test("receipt records native transfers and balance movements, but never labels them revenue", () => {
  const b = draft(),
    r = decodeReceipt(chain(b), b.signature);
  assert.equal(r.status, "finalized");
  assert.equal(r.transfers.length, 2);
  assert.equal(r.accounts[0].delta, "-10005001");
  assert.match(r.hash, /^[a-f0-9]{64}$/);
  assert.equal(r.revenue, undefined);
});
test("failed transaction records its failure and marks listed transfers not executed", () => {
  const b = draft(),
    t = chain(b);
  t.meta.err = { InstructionError: [0, "Custom"] };
  const r = decodeReceipt(t, b.signature);
  assert.equal(r.status, "failed");
  assert.match(receiptText(r), /not executed/);
});
test("receipt refuses incomplete metadata, unsafe balances and a different signature", () => {
  const b = draft();
  for (const change of [
    (t) => {
      t.meta = null;
    },
    (t) => {
      delete t.meta.err;
    },
    (t) => {
      t.meta.preBalances[0] = Number.MAX_SAFE_INTEGER + 1;
    },
    (t) => {
      t.version = 4;
    },
    (t) => {
      t.transaction.signatures = [sig(8)];
    },
    (t) => {
      t.meta.postBalances.pop();
    },
    (t) => {
      t.transaction.message.instructions[0].parsed.info.lamports = -1;
    },
  ]) {
    const t = chain(b);
    change(t);
    assert.throws(() => decodeReceipt(t, b.signature));
  }
});
test("RPC finality, signature, slot and outcome must agree", async () => {
  const b = draft(),
    t = chain(b);
  const rpc = (status) => async (m) =>
    m === "getSignatureStatuses" ? { value: [status] } : t;
  const status = { confirmationStatus: "finalized", slot: t.slot, err: null };
  assert.equal(
    (await readReceipt(rpc(status), b.signature)).receipt.slot,
    t.slot,
  );
  for (const invalid of [
    null,
    { ...status, confirmationStatus: "confirmed" },
    { ...status, slot: 2 },
    { ...status, err: {} },
    { confirmationStatus: "finalized", slot: t.slot },
  ])
    await assert.rejects(readReceipt(rpc(invalid), b.signature));
});
test("settlement verification requires exact payer, recipients, amounts and batch memo", () => {
  const b = draft();
  assert.equal(verifySettlement(b, chain(b)).status, "finalized");
  for (const change of [
    (t) => {
      t.transaction.message.accountKeys[0].signer = false;
    },
    (t) => {
      t.transaction.message.instructions[0].parsed.info.destination =
        address(8);
    },
    (t) => {
      t.transaction.message.instructions[0].parsed.info.lamports++;
    },
    (t) => {
      t.transaction.message.instructions.at(-1).parsed = "CLACK:other";
    },
    (t) => {
      t.transaction.message.instructions.push({
        programId: MEMO,
        parsed: "extra",
      });
    },
    (t) => {
      t.meta.innerInstructions = [
        { index: 0, instructions: [{ programId: MEMO }] },
      ];
    },
    (t) => {
      t.meta.postBalances[0]++;
    },
    (t) => {
      t.meta.err = {};
    },
  ]) {
    const t = chain(b);
    change(t);
    assert.throws(() => verifySettlement(b, t));
  }
});
test("reconciliation finalizes only the original matching successful transaction", async () => {
  const b = draft(),
    t = chain(b);
  b.status = "submitted";
  b.signed = "private";
  const rpc = async (m) =>
    m === "getSignatureStatuses"
      ? {
          value: [
            { confirmationStatus: "finalized", slot: t.slot, err: t.meta.err },
          ],
        }
      : t;
  const r = await reconcileBatch(b, rpc);
  assert.equal(r.status, "finalized");
  assert.equal(r.signed, undefined);
  t.meta.err = { InstructionError: [0, "Custom"] };
  assert.equal((await reconcileBatch(b, rpc)).status, "failed");
});
