import { createHash } from "node:crypto";
import { addressValid, signatureValid } from "../src/domain.mjs";
export const SYSTEM = "11111111111111111111111111111111";
export const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const whole = (n) => Number.isSafeInteger(n) && n >= 0;
export function decodeReceipt(
  tx,
  signature,
  observedAt = new Date().toISOString(),
) {
  if (
    !signatureValid(signature) ||
    !tx ||
    tx.transaction?.signatures?.[0] !== signature ||
    !whole(tx.slot)
  )
    throw Error("Finalized transaction not available.");
  if (tx.version !== undefined && !["legacy", 0, 1].includes(tx.version))
    throw Error("Unsupported transaction version.");
  const meta = tx.meta,
    message = tx.transaction.message,
    keys = message?.accountKeys;
  if (
    !meta ||
    !(
      meta.err === null ||
      (typeof meta.err === "object" && meta.err !== null)
    ) ||
    !whole(meta.fee) ||
    !Array.isArray(keys) ||
    !keys.length ||
    !Array.isArray(message.instructions)
  )
    throw Error("Transaction accounting unavailable.");
  if (
    meta.preBalances?.length !== keys.length ||
    meta.postBalances?.length !== keys.length
  )
    throw Error("Balance accounting unavailable.");
  const accounts = keys.map((k, i) => {
    const address = typeof k === "string" ? k : k.pubkey;
    if (
      !addressValid(address) ||
      !whole(meta.preBalances[i]) ||
      !whole(meta.postBalances[i])
    )
      throw Error("Unsafe or incomplete balance data.");
    return {
      address,
      signer: typeof k === "object" && k.signer === true,
      before: String(meta.preBalances[i]),
      after: String(meta.postBalances[i]),
      delta: (
        BigInt(meta.postBalances[i]) - BigInt(meta.preBalances[i])
      ).toString(),
    };
  });
  const instructions = [
    ...message.instructions.map((ix, index) => ({ ix, index, inner: false })),
    ...(meta.innerInstructions || []).flatMap((group) =>
      group.instructions.map((ix) => ({ ix, index: group.index, inner: true })),
    ),
  ];
  const transfers = [];
  for (const { ix, index, inner } of instructions) {
    if (
      ix.programId !== SYSTEM ||
      !["transfer", "transferWithSeed"].includes(ix.parsed?.type)
    )
      continue;
    const p = ix.parsed.info;
    if (
      !addressValid(p.source) ||
      !addressValid(p.destination) ||
      !whole(p.lamports)
    )
      throw Error("Native transfer accounting unavailable.");
    transfers.push({
      source: p.source,
      destination: p.destination,
      lamports: String(p.lamports),
      index,
      inner,
    });
  }
  return {
    signature,
    slot: tx.slot,
    at: whole(tx.blockTime)
      ? new Date(tx.blockTime * 1000).toISOString()
      : null,
    observedAt,
    status: meta.err === null ? "finalized" : "failed",
    payer: accounts[0].address,
    fee: String(meta.fee),
    transfers,
    accounts,
    instructionCount: instructions.length,
    hash: createHash("sha256").update(JSON.stringify(tx)).digest("hex"),
  };
}
export async function readReceipt(rpc, signature) {
  if (!signatureValid(signature))
    throw Error("Invalid Solana transaction signature.");
  const statuses = await rpc("getSignatureStatuses", [
    [signature],
    { searchTransactionHistory: true },
  ]);
  const status = statuses?.value?.[0];
  if (
    !status ||
    !Object.hasOwn(status, "err") ||
    status.confirmationStatus !== "finalized" ||
    !whole(status.slot)
  )
    throw Error("Transaction is not finalized or unavailable from this RPC.");
  const tx = await rpc("getTransaction", [
    signature,
    {
      encoding: "jsonParsed",
      commitment: "finalized",
      maxSupportedTransactionVersion: 1,
    },
  ]);
  const receipt = decodeReceipt(tx, signature);
  if (
    receipt.slot !== status.slot ||
    (status.err === null) !== (receipt.status === "finalized")
  )
    throw Error("Finalized status mismatch.");
  return { receipt, tx };
}
export function verifySettlement(batch, tx) {
  const r = decodeReceipt(tx, batch.signature);
  if (
    r.status !== "finalized" ||
    r.payer !== batch.payer ||
    !r.accounts[0].signer
  )
    throw Error("Settlement payer or result mismatch.");
  const instructions = tx.transaction.message.instructions;
  if (
    instructions.length !== batch.rows.length + 1 ||
    tx.meta.innerInstructions?.some((g) => g.instructions.length)
  )
    throw Error("Unexpected settlement instructions.");
  for (let i = 0; i < batch.rows.length; i++) {
    const ix = instructions[i],
      row = batch.rows[i],
      p = ix.parsed?.info;
    if (
      ix.programId !== SYSTEM ||
      ix.parsed?.type !== "transfer" ||
      p?.source !== batch.payer ||
      p?.destination !== row.address ||
      String(p.lamports) !== row.lamports
    )
      throw Error("Settlement transfer mismatch.");
  }
  const memo = instructions.at(-1);
  if (memo.programId !== MEMO || memo.parsed !== `CLACK:${batch.id}`)
    throw Error("Settlement memo mismatch.");
  const amount = batch.rows.reduce((n, row) => n + BigInt(row.lamports), 0n);
  if (BigInt(r.accounts[0].delta) !== -amount - BigInt(r.fee))
    throw Error("Settlement balance mismatch.");
  return r;
}
