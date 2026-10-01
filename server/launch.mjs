import { randomUUID } from "node:crypto";
import { updateState } from "./store.mjs";
import { createRpc, MAINNET_GENESIS } from "./rpc.mjs";
import { initialState, scanWallet } from "./pump.mjs";
export async function watchLaunch({
  store = updateState,
  rpc = createRpc(),
  now = Date.now,
} = {}) {
  const start = now(),
    id = randomUUID(),
    bucket = Math.floor(start / 300000);
  const acquired = await store((s) => {
    if (
      !s.identitySettings?.wallet ||
      s.launchState?.pinned ||
      s.watchLease?.until > start ||
      s.watchBucket === bucket
    )
      return null;
    s.watchLease = { id, until: start + 90000 };
    return s;
  });
  if (acquired.watchLease?.id !== id)
    return {
      skipped: true,
      status: acquired.identitySettings ? "idle" : "unconfigured",
    };
  const identity = {
    wallet: acquired.identitySettings.wallet,
    startSlot: acquired.identitySettings.startSlot,
  };
  try {
    if ((await rpc("getGenesisHash")) !== MAINNET_GENESIS)
      throw Error("Mainnet identity mismatch.");
    const result = await scanWallet(
      acquired.launchState || initialState(identity),
      rpc,
      { ...identity, maxTransactions: 32 },
    );
    await store((s) => {
      if (
        s.watchLease?.id !== id ||
        s.watchLease.until < now() ||
        s.identitySettings.wallet !== identity.wallet ||
        s.identitySettings.startSlot !== identity.startSlot
      )
        throw Error("Watcher configuration changed.");
      s.launchState = result.state;
      s.watchAt = new Date(now()).toISOString();
      s.watchBucket = bucket;
      s.watchStatus = result.state.pinned
        ? "verified"
        : result.catchingUp
          ? "catching-up"
          : "watching";
      s.watchLease = null;
      return s;
    });
    return { status: result.state.pinned ? "verified" : "watching" };
  } catch (e) {
    await store((s) => {
      if (s.watchLease?.id !== id) return null;
      s.watchLease = null;
      s.watchStatus = "unavailable";
      return s;
    }).catch(() => {});
    throw e;
  }
}
