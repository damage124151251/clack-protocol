export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export function createRpc() {
  const endpoint =
      process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    deadline = Date.now() + 45000;
  let id = 0,
    nextTransactionAt = 0;
  return async (method, params = []) => {
    // Space expensive public-RPC reads so an active wallet can catch up without a request burst.
    if (method === "getTransaction" && !process.env.SOLANA_RPC_URL) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, nextTransactionAt - Date.now())),
      );
      nextTransactionAt = Date.now() + 1100;
    }
    if (Date.now() >= deadline) throw Error("RPC cycle deadline exceeded.");
    const requestId = ++id;
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
      signal: AbortSignal.timeout(Math.min(7000, deadline - Date.now())),
    });
    if (!r.ok) throw Error("Mainnet RPC unavailable.");
    const j = await r.json();
    if (j.error || j.id !== requestId || !Object.hasOwn(j, "result"))
      throw Error("RPC response unavailable.");
    return j.result;
  };
}
