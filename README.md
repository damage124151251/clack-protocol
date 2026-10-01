# CLACK

A receipt-first Solana treasury desk. Public wallet observation, explicit native SOL distribution batches, exact finalized transaction verification, and a pixel-art receipt machine.

## Run

Node 24, then `npm ci` and `npm run dev`. Open http://127.0.0.1:5251.

The development server creates its own ignored `.local/dev-access.json`. The operator key unlocks administrative controls in the current browser tab. It is not a wallet key. Local state lives in `.local/state.json`; do not commit or distribute either file.

`node scripts/provision.mjs` registers the configured public wallets and activates the developer watcher. It performs no financial transaction. Existing conflicting registrations cause provisioning to stop instead of replacing them.

## Public Wallets

| Responsibility                                | Address                                        |
| --------------------------------------------- | ---------------------------------------------- |
| Intake: incoming/outgoing treasury records    | `Fbj1gmpLTgiidyD3KaRudDjELQPnvtrAWwirx2rfVk3m` |
| Distribution: signs approved SOL batches      | `FDL2ujmRqas2aMmqznCgxi96gM9eis7LPFafV1oJEoWP` |
| Reserve: publicly observed reserve holdings   | `DTQx5tTz93aH9dahbiBDYjDMK4iKKiyeMCzyFKt7q2Wx` |
| Operations: publicly observed operating funds | `6ZxU7yzcpgJNKW1fEWuwdT5xDCFBNM5sNsU1n9gtvb5k` |
| Developer: future CLACK launch detection      | `FzF7sPdYGiaC6D9uajFDD2W8S38XRTTkWPWgQuf9D6wx` |

Roles describe purpose; they are not onchain spending restrictions. Observed wallet balances are not revenue. Up to two earlier transactions per wallet are imported with explicit historical labels. Activation uses a finalized slot.

## Settlement Lifecycle

1. An authenticated operator records a draft with one total SOL amount, one registered distribution payer and up to five recipients.
2. Integer basis-point allocation uses largest remainders. Recipient amounts sum exactly to the total; network fees are additional.
3. Preparation obtains a blockhash, estimates the fee and checks the payer's observed balance. The transaction contains only the specified transfers plus a unique CLACK memo.
4. The distribution wallet reviews and signs it through Phantom or Solflare. The server verifies the exact message and cryptographic signature. The signature is persisted before broadcast.
5. Only successful finalized instructions, payer, amounts, recipients, memo and net payer movement matching the batch can mark it finalized. Failed transactions are recorded separately.

An uncertain broadcast remains pending and retains its original signature. Never create a replacement payment until the original outcome is resolved. Prepared transactions expire with their blockhash and are not silently rebuilt. This release requires operator review for expired or unresolved preparations; it does not automatically cancel, re-sign or replace them. The browser retains signed transaction bytes for recovery in session storage, never wallet private keys. Public APIs omit serialized transaction material.

## Live Observation

Production schedules `/api/tick` every five minutes and `/api/watch` two minutes later. Each requires its own cron credential. Leases and bucket checkpoints prevent overlapping duplicates. Production state uses private Vercel Blob with strong ETag compare-and-swap. Missing RPC data never advances a wallet cursor. Local development has manual checks, not a background scheduler.

The ledger retains 120 wallet receipts and 120 machine events; the settlement register has a hard 100-batch limit. Download records for longer retention. High-volume history beyond 180 signatures between checkpoints fails closed for operator review. RPC outages can delay checks and finality. `SOLANA_RPC_URL` can select a dedicated mainnet RPC; the public endpoint is the fallback. Mainnet genesis is verified before live reads.

The CA remains `soon` until a future finalized Pump creation named CLACK, signed by the registered developer and after activation, passes the program, discriminator, creator, signature and mint-account checks. A transfer to the dev wallet cannot assign the CA. Changing the developer wallet resets the watcher boundary.

## API

| Route                            | Access               | Purpose                                                                                                |
| -------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/status`                | Public               | Wallet observations, receipts, events, batch summaries, token identity                                 |
| `GET /api/receipt?signature=...` | Public               | Verify a finalized Solana transaction                                                                  |
| `GET /api/health`                | Public               | Service identity                                                                                       |
| `GET /api/operator`              | Operator bearer key  | Check operator credential                                                                              |
| `POST /api/operator`             | Operator bearer key  | Register/pause wallets, configure dev watcher, trigger checks, create/prepare/submit/reconcile batches |
| `GET /api/tick`                  | Scheduler bearer key | Run observations and reconciliation                                                                    |
| `GET /api/watch`                 | Scheduler bearer key | Run Pump launch detection                                                                              |

Writes are authenticated, size-bounded and origin-checked. There is no endpoint for storing private keys or arbitrary transaction messages. Add platform-level rate limiting for sustained public traffic; receipt caching is bounded per function instance, not a distributed abuse limiter.

## Verification and Assets

- `npm test`: allocation, signatures, receipts, settlement matching, authorization, storage concurrency, wallet checkpoints and Pump detection tests. Transaction signatures in tests use isolated offline keys, never the treasury wallets.
- `npm run qa`: desktop/mobile browser checks and screenshots. UI settlement tests use clearly isolated test fixtures, not real transfers.
- `npm run build`: production frontend.
- `npm run assets`: bitmap logo/avatar/banner/stills generated from the native Canvas artwork.
- `FFMPEG_PATH=... node scripts/assets.mjs --film`: three eight-second H.264 videos.
- `marketing/POSTS.md`: bio and post copy. No marketing-kit navigation appears in the app.

## Deployment

`node scripts/deploy.mjs` requires `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_SCOPE` in the process environment. It creates only the CLACK project, an independent private Blob store and independent operator/cron credentials. It refuses to take over an unlinked existing project or upgrade the account plan. `CLACK_URL=https://clack-protocol.vercel.app node scripts/provision.mjs` provisions production with its own credential.

Keep `.local`, `.vercel`, `.env.local`, `operator-access.txt` and deployment credentials private. Do not include them in a shared project archive or public repository.

## Scope and Security

This release observes chain data and prepares explicitly signed SOL payments. It does **not** collect Pump creator fees, automatically trade tokenized stocks, identify profits, buy back or burn tokens, take holder snapshots, create revenue-bearing NFTs or promise payouts. Registering wallets does not activate those mechanisms. Implementing them requires a separate reviewed integration and explicit spending authorization.

The software is unaudited. Mainnet reads are tested; no live treasury payout is performed as part of verification. The pinned Solana web3 dependency has three transitive moderate audit entries rooted in `stream-json`. CLACK uses its own bounded HTTP RPC transport instead of the affected Jayson transport; do not interpret that distinction as an audit or zero risk. Do not use `npm audit fix --force` to force an incompatible Solana SDK downgrade.

`uuid` is pinned to 11.1.1 inside Jayson and rpc-websockets: both use supported UUID v4/v1 APIs, and this version exposes CommonJS entry points required by the serverless loader while including the bounds-check fix. Serverless import compatibility is tested with Node's experimental CommonJS-to-ESM bridge disabled.
