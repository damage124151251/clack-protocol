import { randomUUID } from "node:crypto";
import {
  Transaction,
  TransactionInstruction,
  SystemProgram,
  PublicKey,
} from "@solana/web3.js";
import bs58 from "bs58";
import { addressValid, allocations, solToLamports } from "../src/domain.mjs";
import { MEMO, readReceipt, verifySettlement } from "./receipts.mjs";
export function createBatch(input) {
  if (!addressValid(input.payer)) throw Error("Invalid payer address.");
  return {
    id: randomUUID(),
    payer: input.payer,
    amount: solToLamports(input.amount),
    rows: allocations(input.amount, input.rows, input.payer),
    note: String(input.note || "Treasury distribution").slice(0, 100),
    status: "draft",
    createdAt: new Date().toISOString(),
    signature: null,
  };
}
export async function prepareBatch(batch, rpc) {
  if (batch.status !== "draft")
    throw Error(
      "This batch has already been prepared. Recover its existing transaction.",
    );
  const block = await rpc("getLatestBlockhash", [{ commitment: "finalized" }]);
  if (
    !addressValid(block?.value?.blockhash) ||
    !Number.isSafeInteger(block.value.lastValidBlockHeight)
  )
    throw Error("Blockhash unavailable.");
  const tx = new Transaction({
    feePayer: new PublicKey(batch.payer),
    recentBlockhash: block.value.blockhash,
  });
  for (const row of batch.rows)
    tx.add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(batch.payer),
        toPubkey: new PublicKey(row.address),
        lamports: BigInt(row.lamports),
      }),
    );
  tx.add(
    new TransactionInstruction({
      programId: new PublicKey(MEMO),
      keys: [],
      data: Buffer.from(`CLACK:${batch.id}`, "utf8"),
    }),
  );
  const message = tx.serializeMessage().toString("base64");
  const estimate = await rpc("getFeeForMessage", [
    message,
    { commitment: "finalized" },
  ]);
  if (!Number.isSafeInteger(estimate?.value) || estimate.value < 0)
    throw Error("Network fee estimate unavailable.");
  const balance = await rpc("getBalance", [
    batch.payer,
    { commitment: "finalized" },
  ]);
  if (
    !Number.isSafeInteger(balance?.value) ||
    BigInt(balance.value) < BigInt(batch.amount) + BigInt(estimate.value)
  )
    throw Error(
      "Treasury balance does not cover this batch and estimated network fee.",
    );
  return {
    ...batch,
    status: "prepared",
    preparedAt: new Date().toISOString(),
    blockhash: block.value.blockhash,
    lastValidBlockHeight: block.value.lastValidBlockHeight,
    feeEstimate: String(estimate.value),
    message,
    unsigned: tx.serialize({ requireAllSignatures: false }).toString("base64"),
  };
}
export function validateSigned(batch, encoded) {
  if (
    !["prepared", "submitted"].includes(batch.status) ||
    typeof encoded !== "string" ||
    encoded.length > 2200 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  )
    throw Error("Invalid signed settlement.");
  const tx = Transaction.from(Buffer.from(encoded, "base64"));
  if (
    tx.serializeMessage().toString("base64") !== batch.message ||
    !tx.verifySignatures() ||
    !tx.signature
  )
    throw Error("Signed transaction does not match the approved batch.");
  const signature = bs58.encode(tx.signature);
  if (batch.signature && batch.signature !== signature)
    throw Error("Recover the original signed transaction.");
  return signature;
}
export async function reconcileBatch(batch, rpc) {
  if (batch.status !== "submitted" || !batch.signature) return batch;
  const { receipt, tx } = await readReceipt(rpc, batch.signature);
  if (receipt.status === "failed")
    return {
      ...batch,
      status: "failed",
      finishedAt: new Date().toISOString(),
      receipt,
      signed: undefined,
      message: undefined,
      unsigned: undefined,
    };
  const verified = verifySettlement(batch, tx);
  return {
    ...batch,
    status: "finalized",
    finishedAt: new Date().toISOString(),
    receipt: verified,
    signed: undefined,
    message: undefined,
    unsigned: undefined,
  };
}
export function publicBatch(batch) {
  const { signed, message, unsigned, prepareLease, ...safe } = batch;
  return safe;
}
