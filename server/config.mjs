export function initialState() {
  return {
    version: 1,
    revision: 1,
    wallets: [],
    receipts: [],
    batches: [],
    events: [],
    lease: null,
    lastBucket: null,
    lastCompleted: null,
    lastScheduledCompletion: null,
    cycles: 0,
    network: null,
    error: null,
    identitySettings: null,
    watchStatus: "unconfigured",
  };
}
