import test from "node:test";
import assert from "node:assert/strict";
import bs58 from "bs58";
import {
  getStructEncoder,
  addEncoderSizePrefix,
  getUtf8Encoder,
  getU32Encoder,
  fixEncoderSize,
  getBytesEncoder,
} from "@solana/codecs";
import {
  CREATE_SCHEMAS,
  DEV_WALLET as CONFIGURED_WALLET,
  WATCH_START_SLOT,
  PUMP_PROGRAM,
  findLaunches as rawFindLaunches,
  validateMint,
  initialState as rawInitialState,
  validateState as rawValidateState,
  scanWallet as rawScanWallet,
} from "../server/pump.mjs";
const DEV_WALLET =
  CONFIGURED_WALLET || bs58.encode(new Uint8Array(32).fill(18));
const initialState = () => rawInitialState({ wallet: DEV_WALLET });
const validateState = (state) =>
  rawValidateState(state, { wallet: DEV_WALLET });
const findLaunches = (tx, sig) => rawFindLaunches(tx, sig, DEV_WALLET);
const scanWallet = (state, rpc, options = {}) =>
  rawScanWallet(state, rpc, { ...options, wallet: DEV_WALLET });
const signature = (n) =>
  bs58.encode(Uint8Array.from({ length: 64 }, (_, i) => (n + i) % 256));
const mintAddress = (n) => bs58.encode(new Uint8Array(32).fill(n));
const string = () => addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder());
const encoder = getStructEncoder([
  ["name", string()],
  ["symbol", string()],
  ["uri", string()],
  ["creator", fixEncoderSize(getBytesEncoder(), 32)],
]);
function creation({
  type = "create_v2",
  creator = DEV_WALLET,
  user = DEV_WALLET,
  mint = mintAddress(17),
  programId = PUMP_PROGRAM,
  name = "Clack",
} = {}) {
  const s = CREATE_SCHEMAS.find((s) => s.name === type);
  const data = new Uint8Array([
    ...s.discriminator,
    ...encoder.encode({
      name,
      symbol: "CLACK",
      uri: "https://example.org/metadata.json",
      creator: bs58.decode(creator),
    }),
    ...(type === "create_v2" ? [0, 0, 0, 0] : []),
  ]);
  const accounts = Array(s.minimumAccounts).fill(
    "11111111111111111111111111111111",
  );
  accounts[0] = mint;
  accounts[s.user] = user;
  return { programId, accounts, data: bs58.encode(data) };
}
function tx(n = 1, ix = creation()) {
  return {
    slot: WATCH_START_SLOT + n,
    blockTime: 1790821264 + n,
    meta: { err: null, innerInstructions: [] },
    transaction: {
      signatures: [signature(n)],
      message: {
        accountKeys: [
          { pubkey: DEV_WALLET, signer: true, writable: true },
          { pubkey: ix.accounts[0], signer: true, writable: true },
        ],
        instructions: [ix],
      },
    },
  };
}
const history = (n) => ({
  slot: WATCH_START_SLOT + n,
  signature: signature(n),
  err: null,
  confirmationStatus: "finalized",
});
const mintAccount = {
  owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  executable: false,
  data: {
    parsed: { type: "mint", info: { isInitialized: true, decimals: 6 } },
  },
};
test("legacy and v2 creation identify exact mint, developer and signature", () => {
  for (const type of ["create", "create_v2"]) {
    const found = findLaunches(tx(1, creation({ type })), signature(1));
    assert.equal(found.length, 1);
    assert.equal(found[0].mint, mintAddress(17));
    assert.equal(found[0].creator, DEV_WALLET);
    assert.equal(found[0].instruction, type);
  }
});
test("a failed transaction can never publish a mint", () => {
  const t = tx();
  t.meta.err = { InstructionError: [0, "Custom"] };
  assert.deepEqual(findLaunches(t, signature(1)), []);
});
test("transactions predating activation are ignored", () => {
  assert.deepEqual(findLaunches(tx(0), signature(0)), []);
});
test("wallet recipient or nonsigner is not a developer launch", () => {
  const t = tx();
  t.transaction.message.accountKeys[0].signer = false;
  assert.deepEqual(findLaunches(t, signature(1)), []);
});
test("program spoofing is rejected", () => {
  assert.deepEqual(
    findLaunches(tx(1, creation({ programId: mintAddress(9) })), signature(1)),
    [],
  );
});
test("a different user or creator is rejected even if the dev signs elsewhere", () => {
  for (const props of [{ creator: mintAddress(9) }, { user: mintAddress(9) }])
    assert.deepEqual(findLaunches(tx(1, creation(props)), signature(1)), []);
});
test("a purchase or transfer cannot be mistaken for create", () => {
  const ix = creation();
  ix.data = bs58.encode(new Uint8Array(40).fill(1));
  assert.deepEqual(findLaunches(tx(1, ix), signature(1)), []);
});
test("another project from the same developer never becomes the CLACK CA", () => {
  for (const name of ["Delivery Pad", "CLACK rewards", "S\u0399FT"])
    assert.deepEqual(findLaunches(tx(1, creation({ name })), signature(1)), []);
  for (const name of ["CLACK", "clack", "Clack", " CLACK "])
    assert.equal(
      findLaunches(tx(1, creation({ name })), signature(1)).length,
      1,
    );
});
test("persisted proof cannot bypass the token-name filter", () => {
  const proof = findLaunches(tx(1), signature(1))[0];
  assert.throws(() =>
    validateState({
      ...initialState(),
      pinned: { ...proof, name: "Delivery Pad" },
    }),
  );
});
test("signature identity mismatch is rejected", () => {
  assert.deepEqual(findLaunches(tx(1), signature(2)), []);
});
test("legacy, v0 and parsed v1 transactions are supported; unknown future versions stop scanning", () => {
  for (const version of ["legacy", 0, 1])
    assert.equal(findLaunches({ ...tx(1), version }, signature(1)).length, 1);
  assert.throws(
    () => findLaunches({ ...tx(1), version: 2 }, signature(1)),
    /version/,
  );
});
test("inner Pump CPI is read, but only with a real developer signer", () => {
  const t = tx();
  t.meta.innerInstructions = [
    { index: 0, instructions: t.transaction.message.instructions },
  ];
  t.transaction.message.instructions = [];
  assert.equal(findLaunches(t, signature(1)).length, 1);
});
test("recognized malformed creates fail closed instead of silently skipping", () => {
  const ix = creation();
  ix.data = bs58.encode(new Uint8Array(CREATE_SCHEMAS[1].discriminator));
  assert.throws(() => findLaunches(tx(1, ix), signature(1)));
});
test("mint account must be an initialized six-decimal token at a finalized context", () => {
  assert.doesNotThrow(() => validateMint(mintAccount, 100, 100));
  for (const account of [
    null,
    { ...mintAccount, owner: DEV_WALLET },
    { ...mintAccount, executable: true },
    { ...mintAccount, data: { parsed: { type: "account" } } },
  ])
    assert.throws(() => validateMint(account, 100, 100));
  assert.throws(() => validateMint(mintAccount, 99, 100));
});
test("watcher state cannot change the wallet or activation slot", () => {
  assert.doesNotThrow(() => validateState(initialState()));
  assert.throws(() =>
    validateState({ ...initialState(), wallet: mintAddress(8) }),
  );
  assert.throws(() =>
    validateState({ ...initialState(), startSlot: WATCH_START_SLOT + 1 }),
  );
});
test("oldest verified launch is chosen, not a later launch", async () => {
  const rpc = async (method, params) => {
    if (method === "getSignaturesForAddress") return [history(2), history(1)];
    if (method === "getTransaction")
      return params[0] === signature(1)
        ? tx(1)
        : tx(2, creation({ mint: mintAddress(20) }));
    return { context: { slot: WATCH_START_SLOT + 10 }, value: mintAccount };
  };
  const r = await scanWallet(initialState(), rpc);
  assert.equal(r.state.pinned.signature, signature(1));
  assert.equal(r.changed, true);
});
test("a pinned launch survives later checks without any RPC or replacement", async () => {
  const state = {
    ...initialState(),
    pinned: findLaunches(tx(1), signature(1))[0],
  };
  const r = await scanWallet(state, () => {
    throw new Error("Must not scan again");
  });
  assert.equal(r.state.pinned.mint, mintAddress(17));
  assert.equal(r.changed, false);
});
test("scan checkpoint advances after unrelated transfers without changing CA", async () => {
  const transfer = tx(1);
  transfer.transaction.message.instructions = [];
  const r = await scanWallet(initialState(), async (method) =>
    method === "getSignaturesForAddress" ? [history(1)] : transfer,
  );
  assert.equal(r.state.pinned, null);
  assert.equal(r.state.cursorSignature, signature(1));
});
test("null transaction blocks checkpoint advancement", async () => {
  const state = initialState();
  await assert.rejects(() =>
    scanWallet(state, async (method) =>
      method === "getSignaturesForAddress" ? [history(1)] : null,
    ),
  );
  assert.equal(state.cursorSignature, null);
});
test("unfinalized signatures are rejected", async () => {
  await assert.rejects(() =>
    scanWallet(initialState(), async () => [
      { ...history(1), confirmationStatus: "confirmed" },
    ]),
  );
});
test("incomplete pagination cannot select an arbitrary newer token", async () => {
  await assert.rejects(
    () =>
      scanWallet(initialState(), async () => [history(2), history(1)], {
        maxPages: 1,
        pageSize: 2,
      }),
    /scan window/,
  );
});
test("pagination walks newest-to-oldest, then evaluates oldest first", async () => {
  let historyCalls = 0;
  const rpc = async (method, params) => {
    if (method === "getSignaturesForAddress") {
      historyCalls++;
      return params[1].before ? [history(1)] : [history(3), history(2)];
    }
    if (method === "getTransaction") return tx(1);
    return { context: { slot: WATCH_START_SLOT + 10 }, value: mintAccount };
  };
  const r = await scanWallet(initialState(), rpc, { pageSize: 2 });
  assert.equal(historyCalls, 2);
  assert.equal(r.state.pinned.signature, signature(1));
});
test("a transaction creating multiple mints needs explicit selection", async () => {
  const t = tx();
  t.transaction.message.instructions.push(creation({ mint: mintAddress(20) }));
  t.transaction.message.accountKeys.push({
    pubkey: mintAddress(20),
    writable: true,
    signer: true,
  });
  await assert.rejects(
    () =>
      scanWallet(initialState(), async (method) =>
        method === "getSignaturesForAddress" ? [history(1)] : t,
      ),
    /Multiple tokens/,
  );
});
