import bs58 from "bs58";
import {
  getStructDecoder,
  addDecoderSizePrefix,
  getUtf8Decoder,
  getU32Decoder,
  fixDecoderSize,
  getBytesDecoder,
} from "@solana/codecs";
import { DEV_WALLET } from "../src/config.mjs";

export { DEV_WALLET };
export const WATCH_START_SLOT = 0;
export const EXPECTED_TOKEN_NAME = "CLACK";
export function isAddress(value) {
  try {
    return (
      typeof value === "string" &&
      value.length <= 44 &&
      bs58.decode(value).length === 32
    );
  } catch {
    return false;
  }
}
const matchesName = (name) =>
  typeof name === "string" && name.trim().toUpperCase() === EXPECTED_TOKEN_NAME;
export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);

// Account order and shared argument prefix from pump-fun/pump-public-docs/idl/pump.json (2026-10-01).
export const CREATE_SCHEMAS = [
  {
    name: "create",
    discriminator: [24, 30, 200, 40, 5, 28, 7, 119],
    user: 7,
    minimumAccounts: 14,
  },
  {
    name: "create_v2",
    discriminator: [214, 144, 76, 236, 95, 139, 49, 180],
    user: 5,
    minimumAccounts: 16,
  },
];
const text = () => addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder());
const createPrefix = getStructDecoder([
  ["name", text()],
  ["symbol", text()],
  ["uri", text()],
  ["creator", fixDecoderSize(getBytesDecoder(), 32)],
]);
export function signatureValid(signature) {
  try {
    return (
      typeof signature === "string" &&
      signature.length <= 88 &&
      bs58.decode(signature).length === 64
    );
  } catch {
    return false;
  }
}
export function findLaunches(
  transaction,
  expectedSignature,
  wallet = DEV_WALLET,
  startSlot = WATCH_START_SLOT,
) {
  if (
    !transaction ||
    transaction.meta?.err !== null ||
    !Number.isSafeInteger(transaction.slot) ||
    transaction.slot <= startSlot ||
    !signatureValid(expectedSignature) ||
    transaction.transaction?.signatures?.[0] !== expectedSignature
  )
    return [];
  if (
    transaction.version !== undefined &&
    !["legacy", 0, 1].includes(transaction.version)
  )
    throw new Error("Unsupported transaction version.");
  const message = transaction.transaction.message;
  if (
    !message?.accountKeys?.some(
      (key) => key.pubkey === wallet && key.signer === true,
    )
  )
    return [];
  const instructions = [
    ...(message.instructions || []),
    ...(transaction.meta.innerInstructions || []).flatMap(
      (group) => group.instructions || [],
    ),
  ];
  const launches = [];
  for (const ix of instructions) {
    if (ix.programId !== PUMP_PROGRAM || typeof ix.data !== "string") continue;
    const data = bs58.decode(ix.data);
    const schema = CREATE_SCHEMAS.find((s) =>
      s.discriminator.every((b, i) => data[i] === b),
    );
    if (!schema) continue;
    // A recognized but undecodable launch blocks cursor advancement instead of silently skipping it.
    if (
      data.length > 4096 ||
      !Array.isArray(ix.accounts) ||
      ix.accounts.length < schema.minimumAccounts
    )
      throw new Error("Unrecognized Pump create layout.");
    if (ix.accounts[schema.user] !== wallet) continue;
    const decoded = createPrefix.decode(data.subarray(8));
    if (bs58.encode(decoded.creator) !== wallet) continue;
    const mint = ix.accounts[0];
    if (
      !isAddress(mint) ||
      !message.accountKeys.some(
        (key) => key.pubkey === mint && key.writable === true,
      )
    )
      throw new Error("Invalid Pump mint account.");
    if (
      !decoded.name ||
      decoded.name.length > 64 ||
      !decoded.symbol ||
      decoded.symbol.length > 32 ||
      decoded.uri.length > 512
    )
      throw new Error("Invalid Pump token metadata.");
    if (!matchesName(decoded.name)) continue;
    launches.push({
      mint,
      name: decoded.name,
      symbol: decoded.symbol,
      creator: wallet,
      program: PUMP_PROGRAM,
      instruction: schema.name,
      signature: expectedSignature,
      slot: transaction.slot,
      blockTime: transaction.blockTime,
      verifiedAt: Date.now(),
    });
  }
  return launches;
}
export function validateMint(account, contextSlot, minimumSlot) {
  if (
    !account ||
    !TOKEN_PROGRAMS.has(account.owner) ||
    account.executable ||
    account.data?.parsed?.type !== "mint" ||
    account.data.parsed.info?.isInitialized !== true ||
    account.data.parsed.info.decimals !== 6 ||
    !Number.isSafeInteger(contextSlot) ||
    contextSlot < minimumSlot
  )
    throw new Error("The created token mint could not be verified.");
}
export function initialState({
  wallet = DEV_WALLET,
  startSlot = WATCH_START_SLOT,
} = {}) {
  return {
    version: 1,
    wallet,
    expectedName: EXPECTED_TOKEN_NAME,
    startSlot,
    cursorSignature: null,
    cursorSlot: startSlot,
    pinned: null,
  };
}
export function validateState(
  state,
  { wallet = DEV_WALLET, startSlot = WATCH_START_SLOT } = {},
) {
  if (
    state?.version !== 1 ||
    !isAddress(wallet) ||
    state.wallet !== wallet ||
    state.expectedName !== EXPECTED_TOKEN_NAME ||
    state.startSlot !== startSlot ||
    !Number.isSafeInteger(state.cursorSlot) ||
    state.cursorSlot < startSlot ||
    (state.cursorSignature !== null && !signatureValid(state.cursorSignature))
  )
    throw new Error("Watcher state identity mismatch.");
  if (
    state.pinned &&
    (!matchesName(state.pinned.name) ||
      !isAddress(state.pinned.mint) ||
      state.pinned.creator !== wallet ||
      state.pinned.program !== PUMP_PROGRAM ||
      !signatureValid(state.pinned.signature) ||
      !Number.isSafeInteger(state.pinned.slot) ||
      state.pinned.slot <= startSlot)
  )
    throw new Error("Invalid pinned token proof.");
  return state;
}
export async function scanWallet(
  state,
  rpc,
  {
    maxPages = 8,
    pageSize = 100,
    maxTransactions = 6,
    wallet = DEV_WALLET,
    startSlot = WATCH_START_SLOT,
  } = {},
) {
  validateState(state, { wallet, startSlot });
  if (state.pinned) return { state, changed: false, catchingUp: false };
  const signatures = [];
  const seen = new Set();
  let before,
    complete = false;
  for (let page = 0; page < maxPages; page++) {
    const batch = await rpc("getSignaturesForAddress", [
      wallet,
      {
        commitment: "finalized",
        limit: pageSize,
        ...(state.cursorSignature ? { until: state.cursorSignature } : {}),
        ...(before ? { before } : {}),
      },
    ]);
    if (!Array.isArray(batch)) throw new Error("Invalid signature history.");
    for (const item of batch) {
      if (
        !signatureValid(item.signature) ||
        !Number.isSafeInteger(item.slot) ||
        item.confirmationStatus !== "finalized"
      )
        throw new Error("Unfinalized signature history.");
      if (
        item.slot < state.cursorSlot ||
        item.slot <= startSlot ||
        item.signature === state.cursorSignature
      ) {
        complete = true;
        break;
      }
      if (!seen.has(item.signature)) {
        seen.add(item.signature);
        signatures.push(item);
      }
    }
    if (batch.length < pageSize || complete) {
      complete = true;
      break;
    }
    const next = batch.at(-1).signature;
    if (before === next) throw new Error("Non-advancing signature history.");
    before = next;
  }
  if (!complete)
    throw new Error(
      "History exceeds a scan window. No token has been selected.",
    );
  const chronological = signatures.reverse();
  let next = { ...state },
    processed = 0;
  for (const item of chronological.slice(0, maxTransactions)) {
    if (item.err === null) {
      const tx = await rpc("getTransaction", [
        item.signature,
        {
          encoding: "jsonParsed",
          commitment: "finalized",
          maxSupportedTransactionVersion: 1,
        },
      ]);
      if (
        !tx ||
        tx.slot !== item.slot ||
        tx.meta?.err !== null ||
        tx.transaction?.signatures?.[0] !== item.signature
      )
        throw new Error("Finalized transaction is not available yet.");
      const launches = findLaunches(tx, item.signature, wallet, startSlot);
      if (launches.length > 1)
        throw new Error(
          "Multiple tokens in one launch transaction require explicit selection.",
        );
      if (launches.length === 1) {
        const launch = launches[0];
        const mint = await rpc("getAccountInfo", [
          launch.mint,
          {
            encoding: "jsonParsed",
            commitment: "finalized",
            minContextSlot: launch.slot,
          },
        ]);
        validateMint(mint?.value, mint?.context?.slot, launch.slot);
        next = {
          ...next,
          cursorSignature: item.signature,
          cursorSlot: item.slot,
          pinned: launch,
        };
        return { state: next, changed: true, catchingUp: false };
      }
    }
    next.cursorSignature = item.signature;
    next.cursorSlot = item.slot;
    processed++;
  }
  return {
    state: next,
    changed: processed > 0,
    catchingUp: chronological.length > processed,
  };
}
