import bs58 from "bs58";
export function addressValid(s) {
  try {
    return typeof s === "string" && bs58.decode(s).length === 32;
  } catch {
    return false;
  }
}
export function signatureValid(s) {
  try {
    return typeof s === "string" && bs58.decode(s).length === 64;
  } catch {
    return false;
  }
}
export function solToLamports(s) {
  if (typeof s !== "string" || !/^(0|[1-9]\d{0,6})(\.\d{1,9})?$/.test(s))
    throw Error("Enter a SOL amount with at most 9 decimals.");
  const [whole, fraction = ""] = s.split(".");
  const n = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, "0"));
  if (n <= 0n || n > 100000000000000n)
    throw Error("Amount must be greater than zero and at most 100,000 SOL.");
  return n.toString();
}
export function sol(s = "0", digits = 6) {
  const n = BigInt(s),
    sign = n < 0n ? "-" : "",
    a = n < 0n ? -n : n;
  const f = (a % 1000000000n)
    .toString()
    .padStart(9, "0")
    .slice(0, digits)
    .replace(/0+$/, "");
  return `${sign}${a / 1000000000n}${f ? "." + f : ""}`;
}
export function allocations(amount, rows, payer) {
  const total = BigInt(solToLamports(amount));
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 5)
    throw Error("Choose 1 to 5 recipient wallets.");
  const seen = new Set();
  let sum = 0;
  const valid = rows.map((r) => {
    if (!addressValid(r.address) || r.address === payer || seen.has(r.address))
      throw Error(
        "Recipients must be distinct public wallets, different from the payer.",
      );
    seen.add(r.address);
    if (!Number.isInteger(r.bps) || r.bps < 1 || r.bps > 10000)
      throw Error("Invalid allocation percentage.");
    sum += r.bps;
    return {
      address: r.address,
      bps: r.bps,
      label: String(r.label || "Recipient").slice(0, 40),
    };
  });
  if (sum !== 10000) throw Error("Allocations must total 100%.");
  const parts = valid.map((r, index) => ({
    ...r,
    index,
    amount: (total * BigInt(r.bps)) / 10000n,
    remainder: (total * BigInt(r.bps)) % 10000n,
  }));
  let left = total - parts.reduce((n, p) => n + p.amount, 0n);
  for (const p of [...parts].sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  )) {
    if (!left) break;
    p.amount++;
    left--;
  }
  if (parts.some((p) => p.amount <= 0n))
    throw Error("Amount is too small for this split.");
  return parts.map(({ index, remainder, amount, ...r }) => ({
    ...r,
    lamports: amount.toString(),
  }));
}
export function receiptText(r) {
  return [
    "CLACK / SOLANA RECEIPT",
    "======================",
    `Status: ${r.status}`,
    `Signature: ${r.signature}`,
    `Slot: ${r.slot}`,
    `Observed: ${r.observedAt}`,
    `Network fee: ${sol(r.fee, 9)} SOL`,
    `Fee payer: ${r.payer}`,
    "",
    "Parsed native SOL transfers:",
    ...r.transfers.map(
      (t) =>
        `${t.source} -> ${t.destination}: ${sol(t.lamports, 9)} SOL${r.status === "failed" ? " [not executed]" : ""}`,
    ),
    "",
    "Token and application operations are not classified as revenue.",
    `Response SHA-256: ${r.hash}`,
    `https://solscan.io/tx/${r.signature}`,
  ].join("\n");
}
