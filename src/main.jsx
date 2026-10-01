import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Printer,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  Wallet,
  ReceiptText,
  BookOpen,
  Layers3,
  Github,
  RefreshCw,
  KeyRound,
  Download,
  Search,
  Plus,
  Trash2,
  Check,
  CircleAlert,
  Pause,
  Play,
  Radio,
  RotateCcw,
  CheckCheck,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/silkscreen/400.css";
import { GITHUB_URL, X_URL, ROLES } from "./config.mjs";
import { sol, signatureValid, allocations, receiptText } from "./domain.mjs";
import {
  Canvas,
  Icon,
  CopyButton,
  External,
  Modal,
  Intro,
  download,
} from "./ui.jsx";
import { drawDesk } from "./art.mjs";
import "./style.css";
const short = (s, n = 5) => (s ? `${s.slice(0, n)}...${s.slice(-n)}` : "soon");
const date = (t) =>
  t
    ? new Date(t).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : "Not observed";
const age = (t) => {
  if (!t) return "No observation";
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(t)) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
};
const stale = (t) => !t || Date.now() - Date.parse(t) > 720000;
async function request(path, options = {}) {
  const r = await fetch(path, {
      ...options,
      signal: AbortSignal.timeout(58000),
    }),
    d = await r.json();
  if (!r.ok) throw Error(d.error || "Request unavailable.");
  return d;
}
function Status({ value }) {
  return (
    <span className={`status status-${value}`}>
      <i />
      {value === "finalized"
        ? "Finalized"
        : value === "submitted"
          ? "Pending confirmation"
          : value === "prepared"
            ? "Awaiting signature"
            : value === "observing"
              ? "Observing"
              : value === "none"
                ? "No record"
                : value}
    </span>
  );
}
function App() {
  const [data, setData] = useState(null),
    [view, setView] = useState("counter"),
    [modal, setModal] = useState(null),
    [operator, setOperator] = useState(""),
    [signer, setSigner] = useState(null),
    [connected, setConnected] = useState(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [signature, setSignature] = useState(""),
    [selected, setSelected] = useState(null),
    [printing, setPrinting] = useState(false),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [, clock] = useState(0);
  const [intro, setIntro] = useState(() => {
    try {
      return (
        !sessionStorage.getItem("clack-arrived") &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    } catch {
      return false;
    }
  });
  const loading = useRef(false),
    state = useRef(null),
    heading = useRef();
  state.current = data;
  async function refresh() {
    if (loading.current) return;
    loading.current = true;
    try {
      setData(await request("/api/status"));
      setError("");
    } catch (e) {
      setError(
        "Connection interrupted. Previously received records remain visible.",
      );
    } finally {
      loading.current = false;
    }
  }
  useEffect(() => {
    refresh();
    let count = 0;
    const timer = setInterval(() => {
      clock((x) => x + 1);
      count++;
      if (!document.hidden && count % (state.current?.running ? 2 : 20) === 0)
        refresh();
    }, 1000);
    const visible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => setPrinting(false), 3000);
    return () => clearTimeout(t);
  }, [printing]);
  useEffect(() => {
    if (!signer) return;
    const changed = () => {
      setConnected(signer.publicKey?.toString() || null);
    };
    const disconnected = () => {
      setConnected(null);
      setSigner(null);
    };
    signer.on?.("accountChanged", changed);
    signer.on?.("disconnect", disconnected);
    return () => {
      signer.removeListener?.("accountChanged", changed);
      signer.removeListener?.("disconnect", disconnected);
    };
  }, [signer]);
  const finish = () => {
    try {
      sessionStorage.setItem("clack-arrived", "1");
    } catch {}
    setIntro(false);
  };
  const nav = (name) => {
    setView(name);
    window.scrollTo({ top: 0, behavior: "instant" });
    setTimeout(() => heading.current?.focus(), 0);
  };
  async function act(input) {
    if (!operator) {
      setModal({ type: "auth" });
      return null;
    }
    setBusy(true);
    try {
      const result = await request("/api/operator", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${operator}`,
        },
        body: JSON.stringify(input),
      });
      await refresh();
      return result;
    } catch (e) {
      setNotice(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function inspect(e) {
    e?.preventDefault();
    if (!signatureValid(signature.trim())) {
      setNotice("Enter a valid Solana transaction signature.");
      return;
    }
    setBusy(true);
    try {
      const r = await request(
        `/api/receipt?signature=${encodeURIComponent(signature.trim())}`,
      );
      setSelected({ ...r, local: true });
      setPrinting(true);
      setNotice("Finalized transaction inspected. Receipt ready.");
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function connect(name) {
    const provider =
      name === "Phantom" ? window.phantom?.solana : window.solflare;
    if (!provider) {
      setNotice(`${name} is not available in this browser.`);
      return;
    }
    try {
      const r = await provider.connect();
      setConnected((r?.publicKey || provider.publicKey)?.toString());
      setSigner(provider);
      setModal(null);
    } catch {
      setNotice("Wallet connection was not approved.");
    }
  }
  async function signBatch(batch) {
    if (!connected || !signer) {
      setModal({ type: "connect" });
      return;
    }
    if (
      connected !== batch.payer ||
      signer.publicKey?.toString() !== batch.payer
    ) {
      setNotice("Connect the exact distribution wallet shown on this batch.");
      return;
    }
    const recoveryKey = `clack-signed:${batch.id}`;
    const known = sessionStorage.getItem(recoveryKey);
    if (known) {
      const r = await act({
        action: "submit-batch",
        id: batch.id,
        signed: known,
      });
      if (r) setModal({ type: "batch", batch: r.batch });
      return;
    }
    const r = await act({
      action: batch.status === "draft" ? "prepare-batch" : "recover-batch",
      id: batch.id,
    });
    if (!r?.unsigned) return;
    setBusy(true);
    try {
      const { Transaction } = await import("@solana/web3.js");
      const tx = Transaction.from(
        Uint8Array.from(atob(r.unsigned), (c) => c.charCodeAt(0)),
      );
      if (tx.feePayer.toBase58() !== connected) throw Error("Payer mismatch.");
      const signed = await signer.signTransaction(tx);
      const encoded = btoa(String.fromCharCode(...signed.serialize()));
      sessionStorage.setItem(recoveryKey, encoded);
      const result = await act({
        action: "submit-batch",
        id: batch.id,
        signed: encoded,
      });
      if (result) {
        setModal({ type: "batch", batch: result.batch });
        setNotice(
          result.message ||
            "Submitted. Waiting for exact finalized verification.",
        );
      }
    } catch (e) {
      setNotice(
        "Signing interrupted. Open this batch again to recover its existing preparation; do not create a duplicate payment.",
      );
    } finally {
      setBusy(false);
    }
  }
  const wallets = data?.wallets || [],
    receipts = data?.receipts || [],
    batches = data?.batches || [],
    identity = data?.identity || {};
  const receipt = selected || receipts[0] || data?.sample;
  const sample = receipt && !receipt.wallet && !receipt.local;
  const settled = batches
    .filter((b) => b.status === "finalized")
    .reduce((n, b) => n + BigInt(b.amount), 0n);
  const balance = wallets.reduce((n, w) => n + BigInt(w.balance || "0"), 0n);
  const ledger = receipts.filter(
    (r) =>
      (filter === "all" || r.role === filter) &&
      (!query ||
        `${r.signature} ${r.wallet} ${r.role}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  return (
    <>
      {intro && <Intro finish={finish} />}
      <header className="masthead">
        <button
          className="brand"
          onClick={() => nav("counter")}
          aria-label="CLACK counter"
        >
          <img src="/brand/clack-mark.png" alt="" />
          CLACK<span className="brand-period">.</span>
        </button>
        <nav aria-label="Main navigation">
          {[
            ["counter", Printer, "Counter"],
            ["wallets", Wallet, "Wallets"],
            ["settlements", Layers3, "Settlements"],
            ["ledger", ReceiptText, "Ledger"],
            ["guide", BookOpen, "Docs"],
          ].map(([id, I, label]) => (
            <button
              key={id}
              aria-current={view === id ? "page" : undefined}
              className={view === id ? "current" : ""}
              onClick={() => nav(id)}
            >
              <I size={15} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="mast-actions">
          <Icon title="Replay opening" onClick={() => setIntro(true)}>
            <RotateCcw size={16} />
          </Icon>
          <button
            className="wallet-button"
            onClick={() =>
              setModal({ type: connected ? "connection" : "connect" })
            }
          >
            <Wallet size={15} />
            <span>{connected ? short(connected) : "Connect wallet"}</span>
          </button>
        </div>
      </header>
      <div className="network-strip">
        <span>
          <i
            className={stale(data?.network?.observedAt) ? "dot muted" : "dot"}
          />
          Solana mainnet
        </span>
        <span>
          Finalized slot <b>{data?.network?.slot?.toLocaleString() || "--"}</b>
        </span>
        <span className="network-age">{age(data?.network?.observedAt)}</span>
        <button onClick={() => setModal({ type: "token" })}>
          CA {short(identity.tokenCA)}
          <Radio size={12} />
        </button>
      </div>
      {error && (
        <div className="connection-error" role="alert">
          <CircleAlert size={15} />
          {error}
          <button onClick={refresh}>Retry</button>
        </div>
      )}
      <main>
        <div className="page-heading">
          <div>
            <span className="micro">SOLANA / PUBLIC TREASURY RECORDS</span>
            <h1 ref={heading} tabIndex={-1}>
              {
                {
                  counter: "Every movement. On record.",
                  wallets: "The wallets.",
                  settlements: "The settlement desk.",
                  ledger: "The paper trail.",
                  guide: "Inside the machine.",
                }[view]
              }
            </h1>
          </div>
          <div className="heading-aside">
            <span>
              {data?.running ? "CHECK IN PROGRESS" : "LAST COMPLETED CHECK"}
            </span>
            <b>{age(data?.lastCompleted)}</b>
            <Icon title="Refresh recorded data" onClick={refresh}>
              <RefreshCw size={15} />
            </Icon>
          </div>
        </div>
        {view === "counter" && (
          <>
            <section className="counter-stage" aria-label="Receipt workstation">
              <div className="stage-label">
                <span>CLACK / UNIT 001</span>
                <span>
                  <i className={busy || data?.running ? "dot active" : "dot"} />
                  {busy
                    ? "Verifying"
                    : printing
                      ? "Printing receipt"
                      : data?.running
                        ? "Observing chain"
                        : "Ready"}
                </span>
              </div>
              <div className="machine-layout">
                <aside className="process-rail">
                  <span className="micro">THE PROCESS</span>
                  {[
                    ["01", "Receive", "Public chain input"],
                    ["02", "Reconcile", "Exact finalized record"],
                    ["03", "Print", "A receipt you can inspect"],
                  ].map(([num, title, desc]) => (
                    <div key={num}>
                      <span>{num}</span>
                      <section>
                        <b>{title}</b>
                        <small>{desc}</small>
                      </section>
                    </div>
                  ))}
                  <button className="text-button" onClick={() => nav("guide")}>
                    Read the method <ArrowRight size={13} />
                  </button>
                </aside>
                <Canvas
                  label="Pixel-art CLACK receipt printer"
                  className="printer-scene"
                  animated
                  draw={(c, w, h, t) => drawDesk(c, w, h, t, printing || busy)}
                />
                <aside className="receipt-peek">
                  <div className="paper-top">
                    <ReceiptText size={16} />
                    <span>
                      {receipt
                        ? sample
                          ? "NETWORK SAMPLE"
                          : "CHAIN RECEIPT"
                        : "NO RECEIPT"}
                    </span>
                  </div>
                  <div className="paper-body">
                    <b className="paper-brand">CLACK</b>
                    <span className="paper-code">
                      {receipt ? short(receipt.signature, 7) : "Awaiting input"}
                    </span>
                    <hr />
                    <dl>
                      <dt>Status</dt>
                      <dd>{receipt?.status || "--"}</dd>
                      <dt>Slot</dt>
                      <dd>{receipt?.slot?.toLocaleString() || "--"}</dd>
                      <dt>Network fee</dt>
                      <dd>{receipt ? `${sol(receipt.fee, 9)} SOL` : "--"}</dd>
                    </dl>
                    <div className="barcode" aria-hidden="true">
                      {Array.from({ length: 32 }, (_, i) => (
                        <i
                          key={i}
                          style={{ width: `${[1, 3, 2, 1, 4][i % 5]}px` }}
                        />
                      ))}
                    </div>
                    <button
                      className="paper-open"
                      disabled={!receipt}
                      onClick={() =>
                        setModal({ type: "receipt", receipt, sample })
                      }
                    >
                      Open receipt <ArrowUpRight size={15} />
                    </button>
                    {sample && (
                      <small className="sample-note">
                        Public network sample.
                        <br />
                        Not CLACK revenue.
                      </small>
                    )}
                    {receipt?.imported && (
                      <small className="sample-note">
                        Imported history. Before activation.
                      </small>
                    )}
                  </div>
                </aside>
              </div>
              <form className="signature-form" onSubmit={inspect}>
                <label htmlFor="signature">Inspect a transaction</label>
                <div>
                  <ReceiptText size={17} />
                  <input
                    id="signature"
                    value={signature}
                    onChange={(e) => setSignature(e.target.value)}
                    placeholder="Solana transaction signature"
                    autoComplete="off"
                    spellCheck="false"
                    maxLength={100}
                  />
                  <button
                    className="primary"
                    disabled={busy || !signature.trim()}
                  >
                    <Printer size={16} />
                    {busy ? "Verifying..." : "Verify & print"}
                  </button>
                </div>
              </form>
            </section>
            <section className="totals" aria-label="Treasury totals">
              <div>
                <span>Wallets observed</span>
                <b>
                  {wallets.length.toString().padStart(2, "0")}
                  <small> / 05 slots</small>
                </b>
              </div>
              <div>
                <span>Observed wallet balances</span>
                <b>
                  {sol(balance)}
                  <small> SOL</small>
                </b>
              </div>
              <div>
                <span>Verified CLACK settlements</span>
                <b>
                  {sol(settled)}
                  <small> SOL</small>
                </b>
              </div>
              <div>
                <span>Recorded wallet receipts</span>
                <b>{receipts.length.toString().padStart(2, "0")}</b>
              </div>
            </section>
            <section className="counter-bottom">
              <div>
                <div className="section-heading">
                  <h2>At the counter</h2>
                  <button className="text-button" onClick={() => nav("ledger")}>
                    All records <ArrowRight size={14} />
                  </button>
                </div>
                <ReceiptList
                  receipts={receipts.slice(0, 4)}
                  open={(r) => setModal({ type: "receipt", receipt: r })}
                />
                {!receipts.length && (
                  <Empty
                    title="No wallet receipts yet"
                    text="Public wallet records appear after observation."
                  />
                )}
              </div>
              <div className="cycle-log">
                <div className="section-heading">
                  <h2>Machine log</h2>
                  <span>
                    {data?.scheduler?.configured
                      ? "Every 5 min"
                      : "Manual checks"}
                  </span>
                </div>
                {(data?.events || []).slice(0, 5).map((e) => (
                  <div className="log-line" key={e.id}>
                    <span className={`log-mark ${e.stage}`} />
                    <div>
                      <b>{e.stage}</b>
                      <p>{e.detail}</p>
                    </div>
                    <time>{age(e.at)}</time>
                  </div>
                ))}
                {!data?.events?.length && (
                  <Empty
                    title="Waiting for the first check"
                    text="No completed cycle has been recorded."
                  />
                )}
              </div>
            </section>
          </>
        )}
        {view === "wallets" && (
          <section className="wallet-page">
            <div className="section-heading">
              <p>Separate responsibilities. Public addresses.</p>
              <button
                className="primary"
                onClick={() =>
                  setModal({ type: operator ? "add-wallet" : "auth" })
                }
              >
                <Plus size={15} />
                Add wallet
              </button>
            </div>
            <div className="wallet-columns">
              <span>Responsibility / address</span>
              <span>Observed balance</span>
              <span>Observation</span>
              <span />
            </div>
            {wallets.map((w, i) => (
              <article className="wallet-row" key={w.id}>
                <div
                  className="wallet-index"
                  style={{
                    background: ROLES.find((r) => r.id === w.role)?.color,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="wallet-info">
                  <h2>{w.label}</h2>
                  <p>{ROLES.find((r) => r.id === w.role)?.description}</p>
                  <div className="address">
                    <code>{w.address}</code>
                    <CopyButton value={w.address} />
                  </div>
                </div>
                <div className="wallet-balance">
                  <b>{sol(w.balance)}</b>
                  <span>SOL / {age(w.checkedAt)}</span>
                </div>
                <div className="wallet-state">
                  <Status
                    value={
                      !w.enabled
                        ? "paused"
                        : w.error
                          ? "unavailable"
                          : stale(w.checkedAt)
                            ? "stale"
                            : w.status
                    }
                  />
                  <small>From slot {w.startSlot.toLocaleString()}</small>
                </div>
                <div className="wallet-tools">
                  <External href={`https://solscan.io/account/${w.address}`}>
                    Explorer
                  </External>
                  <Icon
                    title={w.enabled ? `Pause ${w.label}` : `Resume ${w.label}`}
                    disabled={busy}
                    onClick={() =>
                      act({
                        action: "toggle-wallet",
                        id: w.id,
                        enabled: !w.enabled,
                      })
                    }
                  >
                    {w.enabled ? <Pause size={16} /> : <Play size={16} />}
                  </Icon>
                </div>
              </article>
            ))}
            {!wallets.length && (
              <Empty
                title="Wallet register is empty"
                text="No wallet has been activated for this protocol."
              />
            )}
            <div className="plain-note">
              <ShieldCheck size={17} />
              <p>
                Balances are observations, not revenue. Naming a wallet does not
                grant CLACK signing authority. Historical imports are marked
                separately.
              </p>
            </div>
            <section className="developer-row">
              <div>
                <h2>Developer identity</h2>
                <code>{identity.wallet || "Not configured"}</code>
              </div>
              <div>
                <Status value={identity.watchStatus || "unconfigured"} />
                <button
                  className="text-button"
                  onClick={() => setModal({ type: "token" })}
                >
                  Token monitor <ArrowRight size={14} />
                </button>
              </div>
            </section>
          </section>
        )}
        {view === "settlements" && (
          <>
            <section className="settlement-layout">
              <SettlementEditor
                wallets={wallets}
                busy={busy}
                create={async (input) => {
                  const r = await act({ action: "create-batch", ...input });
                  if (r) setModal({ type: "batch", batch: r.batch });
                }}
              />
              <aside className="settlement-method">
                <span className="micro">FROM PLAN TO RECEIPT</span>
                <h2>
                  Prepared is
                  <br />
                  not paid.
                </h2>
                {[
                  [
                    "Allocate",
                    "Exact lamport amounts. The percentages must total 100%.",
                  ],
                  [
                    "Approve",
                    "The distribution wallet signs the complete transaction.",
                  ],
                  [
                    "Reconcile",
                    "The exact finalized transfers and batch memo are verified.",
                  ],
                ].map(([title, text], i) => (
                  <div key={title}>
                    <span>{i + 1}</span>
                    <section>
                      <h3>{title}</h3>
                      <p>{text}</p>
                    </section>
                  </div>
                ))}
                <p className="muted">
                  Native SOL only. Network fee is additional. No automatic
                  holder payouts, token swaps or revenue claims.
                </p>
              </aside>
            </section>
            <section className="batch-history">
              <div className="section-heading">
                <h2>Settlement register</h2>
                <span>{batches.length} batches</span>
              </div>
              {batches.length ? (
                batches.map((b) => (
                  <button
                    className="batch-row"
                    key={b.id}
                    onClick={() => setModal({ type: "batch", batch: b })}
                  >
                    <span>
                      <b>{b.note}</b>
                      <small>
                        {b.id.slice(0, 8)} / {date(b.createdAt)}
                      </small>
                    </span>
                    <span>{b.rows.length} recipients</span>
                    <b>{sol(b.amount)} SOL</b>
                    <Status value={b.status} />
                    <ArrowUpRight size={15} />
                  </button>
                ))
              ) : (
                <Empty
                  title="No settlement batches"
                  text="A batch is only marked finalized after its exact payment is verified."
                />
              )}
            </section>
          </>
        )}
        {view === "ledger" && (
          <section className="ledger-page">
            <div className="ledger-toolbar">
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="Search receipts"
                  placeholder="Search signature, wallet or role"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <select
                aria-label="Filter wallet role"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All wallets</option>
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button
                className="outline"
                onClick={() =>
                  download(
                    { exportedAt: new Date().toISOString(), receipts: ledger },
                    "clack-ledger.json",
                  )
                }
              >
                <Download size={15} />
                Export
              </button>
            </div>
            <ReceiptList
              receipts={ledger}
              open={(r) => setModal({ type: "receipt", receipt: r })}
            />
            {!ledger.length && (
              <Empty
                title="No matching records"
                text="Change the filter or return after the next wallet check."
              />
            )}
            <p className="footnote">
              Latest 120 wallet records retained. Imports predate monitoring. A
              transaction can appear under more than one registered wallet;
              amounts must not be summed as protocol revenue.
            </p>
          </section>
        )}
        {view === "guide" && <Guide wallets={wallets} />}
      </main>
      <footer>
        <button className="footer-brand" onClick={() => nav("counter")}>
          CLACK<span>Every movement. On record.</span>
        </button>
        <div>
          <External href={identity.github || GITHUB_URL}>
            <Github size={15} />
            GitHub
          </External>
          {(identity.x || X_URL) && (
            <External href={identity.x || X_URL}>X</External>
          )}
          <button
            onClick={() => setModal({ type: operator ? "session" : "auth" })}
          >
            <KeyRound size={15} />
            Operator
          </button>
          <button onClick={() => setModal({ type: "token" })}>
            CA {short(identity.tokenCA)}
          </button>
        </div>
      </footer>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {modal?.type === "receipt" && (
        <ReceiptModal
          receipt={modal.receipt}
          sample={modal.sample}
          close={() => setModal(null)}
        />
      )}
      {modal?.type === "auth" && (
        <Auth
          close={() => setModal(null)}
          success={(key) => {
            setOperator(key);
            setModal(null);
            setNotice("Operator controls unlocked for this tab.");
          }}
        />
      )}
      {modal?.type === "session" && (
        <Modal title="Operator session" close={() => setModal(null)}>
          <p>
            Controls are unlocked in this tab. Wallet signatures are still
            required to move funds.
          </p>
          <button
            className="primary"
            onClick={() => {
              setOperator("");
              setModal(null);
            }}
          >
            Lock controls
          </button>
        </Modal>
      )}
      {modal?.type === "connect" && (
        <Modal title="Connect wallet" close={() => setModal(null)}>
          <p>Connection does not sign or send a transaction.</p>
          {["Phantom", "Solflare"].map((name) => (
            <button
              className="provider-button"
              key={name}
              onClick={() => connect(name)}
            >
              <Wallet size={21} />
              {name}
              <ArrowRight size={17} />
            </button>
          ))}
          <p className="muted">
            Use the wallet extension or its mobile browser. Never enter a seed
            phrase here.
          </p>
        </Modal>
      )}
      {modal?.type === "connection" && (
        <Modal title="Connected wallet" close={() => setModal(null)}>
          <div className="address">
            <code>{connected}</code>
            <CopyButton value={connected} />
          </div>
          <button
            className="outline"
            onClick={async () => {
              await signer?.disconnect?.();
              setConnected(null);
              setSigner(null);
              setModal(null);
            }}
          >
            <Unplug size={15} />
            Disconnect
          </button>
        </Modal>
      )}
      {modal?.type === "add-wallet" && (
        <AddWallet
          busy={busy}
          close={() => setModal(null)}
          add={async (input) => {
            const r = await act({ action: "add-wallet", ...input });
            if (r) setModal(null);
          }}
          wallets={wallets}
        />
      )}
      {modal?.type === "token" && (
        <TokenMonitor
          identity={identity}
          busy={busy}
          close={() => setModal(null)}
          save={async (wallet) => {
            const r = await act({ action: "set-wallet", wallet });
            if (r) setModal(null);
          }}
        />
      )}
      {modal?.type === "batch" && (
        <BatchModal
          batch={batches.find((b) => b.id === modal.batch.id) || modal.batch}
          close={() => setModal(null)}
          busy={busy}
          connected={connected}
          sign={signBatch}
          check={async (b) => {
            const r = await act({ action: "check-batch", id: b.id });
            if (r) {
              setModal({ type: "batch", batch: r.batch });
              if (r.batch.status === "finalized") setPrinting(true);
            }
          }}
        />
      )}
    </>
  );
}
function Empty({ title, text }) {
  return (
    <div className="empty">
      <ReceiptText size={26} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function ReceiptList({ receipts, open }) {
  return (
    <div className="receipt-list">
      {receipts.map((r) => (
        <button
          className="receipt-row"
          key={`${r.signature}:${r.wallet}`}
          onClick={() => open(r)}
        >
          <span className="receipt-symbol">
            <ReceiptText size={17} />
          </span>
          <span>
            <b>
              {ROLES.find((role) => role.id === r.role)?.label ||
                "Chain record"}
            </b>
            <small>
              {short(r.signature, 8)}
              {r.imported ? " / historical import" : ""}
            </small>
          </span>
          <span className="receipt-time">{date(r.observedAt)}</span>
          <Status value={r.status} />
          <ArrowUpRight size={14} />
        </button>
      ))}
    </div>
  );
}
function ReceiptModal({ receipt: r, sample, close }) {
  return (
    <Modal
      title={sample ? "Public network sample" : "Transaction receipt"}
      close={close}
      wide
    >
      <div className="receipt-detail">
        <div className="detail-title">
          <Printer size={23} />
          <b>CLACK</b>
          <Status value={r.status} />
        </div>
        {sample && (
          <p className="plain-note">
            This is a public network sample, not protocol revenue or a CLACK
            settlement.
          </p>
        )}
        {r.imported && (
          <p className="plain-note">
            Historical import: this transaction predates wallet monitoring.
          </p>
        )}
        {r.status === "failed" && (
          <p role="alert" className="warning">
            This transaction failed. Listed transfer instructions did not
            execute. Network fees may still apply.
          </p>
        )}
        <dl className="details">
          <dt>Signature</dt>
          <dd>
            <code>{r.signature}</code>
            <CopyButton value={r.signature} />
          </dd>
          <dt>Finalized slot</dt>
          <dd>{r.slot.toLocaleString()}</dd>
          <dt>Chain timestamp</dt>
          <dd>{date(r.at)}</dd>
          <dt>Observed</dt>
          <dd>{date(r.observedAt)}</dd>
          <dt>Fee payer</dt>
          <dd>
            <code>{r.payer}</code>
          </dd>
          <dt>Network fee</dt>
          <dd>{sol(r.fee, 9)} SOL</dd>
        </dl>
        <h3>Parsed native SOL transfers</h3>
        {r.transfers.length ? (
          r.transfers.map((t, i) => (
            <div className="transfer" key={i}>
              <code>{t.source}</code>
              <ArrowRight size={14} />
              <code>{t.destination}</code>
              <strong>{sol(t.lamports, 9)} SOL</strong>
            </div>
          ))
        ) : (
          <p className="muted">
            No parsed native SOL transfer. Other instructions may be present.
          </p>
        )}
        <h3>SOL balance movements</h3>
        {r.accounts
          .filter((a) => a.delta !== "0")
          .map((a) => (
            <div className="balance-change" key={a.address}>
              <code>{a.address}</code>
              <b>
                {BigInt(a.delta) > 0n ? "+" : ""}
                {sol(a.delta, 9)} SOL
              </b>
            </div>
          ))}
        <p className="footnote">
          Net movements include fees and account funding. They are not
          classified as trading profits, creator fees or revenue.
        </p>
        <details>
          <summary>Response checksum</summary>
          <code className="hash">{r.hash}</code>
          <p className="muted">
            SHA-256 fingerprints the RPC response. It is not a provider
            signature or an audit.
          </p>
        </details>
        <div className="modal-actions">
          <External href={`https://solscan.io/tx/${r.signature}`}>
            View transaction
          </External>
          <button
            className="outline"
            onClick={() => download(r, `clack-${r.signature.slice(0, 8)}.json`)}
          >
            <Download size={15} />
            JSON
          </button>
          <button
            className="outline"
            onClick={() =>
              download(
                receiptText(r),
                `clack-${r.signature.slice(0, 8)}.txt`,
                "text/plain",
              )
            }
          >
            <ReceiptText size={15} />
            Receipt
          </button>
        </div>
      </div>
    </Modal>
  );
}
function Auth({ close, success }) {
  const [key, set] = useState(""),
    [error, fail] = useState(""),
    [busy, wait] = useState(false);
  return (
    <Modal title="Operator access" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          wait(true);
          try {
            await request("/api/operator", {
              headers: { Authorization: `Bearer ${key}` },
            });
            success(key);
          } catch {
            fail("Operator key was not accepted.");
          } finally {
            wait(false);
          }
        }}
      >
        <label>
          Operator key
          <input
            autoComplete="off"
            type="password"
            value={key}
            onChange={(e) => set(e.target.value)}
            required
          />
        </label>
        <p className="muted">
          Private operator credential. Not a wallet seed or private key.
        </p>
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={busy || !key}>
          <KeyRound size={15} />
          Unlock controls
        </button>
      </form>
    </Modal>
  );
}
function AddWallet({ wallets, add, busy, close }) {
  const [role, setRole] = useState(
      ROLES.find((r) => !wallets.some((w) => w.role === r.id))?.id || "",
    ),
    [address, setAddress] = useState("");
  return (
    <Modal title="Register a public wallet" close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add({ address: address.trim(), role });
        }}
      >
        <label>
          Responsibility
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.filter((r) => !wallets.some((w) => w.role === r.id)).map(
              (r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Public Solana address
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
            spellCheck="false"
          />
        </label>
        <p className="muted">
          Registration is public. Tracking starts at a finalized slot. Up to two
          earlier records may be imported and labeled historical.
        </p>
        <button className="primary" disabled={busy || !role}>
          <Plus size={15} />
          Activate observation
        </button>
      </form>
    </Modal>
  );
}
function TokenMonitor({ identity, save, busy, close }) {
  const [wallet, set] = useState(identity.wallet || "");
  return (
    <Modal title="Token identity" close={close}>
      <dl className="details">
        <dt>Contract address</dt>
        <dd>
          {identity.tokenCA ? (
            <>
              <code>{identity.tokenCA}</code>
              <CopyButton value={identity.tokenCA} />
            </>
          ) : (
            "soon"
          )}
        </dd>
        <dt>Watcher</dt>
        <dd>{identity.watchStatus}</dd>
        <dt>Last check</dt>
        <dd>{date(identity.checkedAt)}</dd>
      </dl>
      {identity.proof && (
        <External href={`https://solscan.io/tx/${identity.proof.signature}`}>
          Launch transaction
        </External>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(wallet.trim());
        }}
      >
        <label>
          Public developer wallet
          <input
            value={wallet}
            onChange={(e) => set(e.target.value)}
            required
            spellCheck="false"
          />
        </label>
        <p className="muted">
          Only a future verified Pump creation named CLACK can be pinned.
          Incoming tokens and other launches do not become the CA.
        </p>
        <button
          className="outline"
          disabled={busy || wallet === identity.wallet}
        >
          <Radio size={15} />
          Activate watcher
        </button>
      </form>
    </Modal>
  );
}
function SettlementEditor({ wallets, busy, create }) {
  const payer = wallets.find((w) => w.role === "distribution" && w.enabled),
    [amount, setAmount] = useState(""),
    [note, setNote] = useState("Treasury distribution"),
    [rows, setRows] = useState([
      { address: "", percent: "100", label: "Recipient 1" },
    ]);
  const mapped = rows.map((r) => ({
    ...r,
    bps: Math.round(Number(r.percent) * 100),
  }));
  let preview = [],
    validation = "";
  try {
    preview = allocations(amount, mapped, payer?.address);
  } catch (e) {
    validation = e.message;
  }
  const change = (i, field, value) =>
    setRows((rs) =>
      rs.map((r, index) => (index === i ? { ...r, [field]: value } : r)),
    );
  return (
    <form
      className="settlement-form"
      onSubmit={(e) => {
        e.preventDefault();
        create({ payer: payer.address, amount, rows: mapped, note });
      }}
    >
      <div className="section-heading">
        <h2>New distribution</h2>
        <span>SOL only</span>
      </div>
      <label>
        Payer
        <code className="payer-address">
          {payer?.address || "Distribution wallet not configured"}
        </code>
      </label>
      <div className="form-pair">
        <label>
          Total amount
          <div className="amount-input">
            <input
              aria-label="Total SOL amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            <span>SOL</span>
          </div>
        </label>
        <label>
          Reference
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={100}
          />
        </label>
      </div>
      <h3>Recipients</h3>
      {rows.map((r, i) => (
        <div className="recipient-input" key={i}>
          <label>
            Wallet {i + 1}
            <input
              aria-label={`Recipient ${i + 1} address`}
              placeholder="Public Solana address"
              spellCheck="false"
              value={r.address}
              onChange={(e) => change(i, "address", e.target.value)}
            />
          </label>
          <label>
            Share %
            <input
              aria-label={`Recipient ${i + 1} percentage`}
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              value={r.percent}
              onChange={(e) => change(i, "percent", e.target.value)}
            />
          </label>
          <Icon
            title={`Remove recipient ${i + 1}`}
            disabled={rows.length === 1}
            onClick={() =>
              setRows((rs) => rs.filter((_, index) => index !== i))
            }
          >
            <Trash2 size={15} />
          </Icon>
        </div>
      ))}
      <button
        className="text-button"
        type="button"
        disabled={rows.length === 5}
        onClick={() =>
          setRows((r) => [
            ...r,
            { address: "", percent: "0", label: `Recipient ${r.length + 1}` },
          ])
        }
      >
        <Plus size={14} />
        Add recipient
      </button>
      <div className="allocation-preview">
        {preview.length ? (
          preview.map((r, i) => (
            <div key={r.address}>
              <span>
                {i + 1} / {short(r.address)}
              </span>
              <b>{sol(r.lamports, 9)} SOL</b>
            </div>
          ))
        ) : (
          <p>{amount || rows[0].address ? validation : "Allocation preview"}</p>
        )}
      </div>
      <button className="primary" disabled={busy || !payer || !preview.length}>
        <Layers3 size={16} />
        Record batch
      </button>
      <p className="footnote">
        Recording a batch moves no funds. The distribution wallet must approve
        the exact transaction separately.
      </p>
    </form>
  );
}
function BatchModal({ batch: b, close, busy, connected, sign, check }) {
  return (
    <Modal title={`Batch ${b.id.slice(0, 8)}`} close={close} wide>
      <div className="batch-summary">
        <Status value={b.status} />
        <b>{sol(b.amount, 9)} SOL</b>
        <p>{b.note}</p>
      </div>
      <dl className="details">
        <dt>Payer</dt>
        <dd>
          <code>{b.payer}</code>
        </dd>
        <dt>Created</dt>
        <dd>{date(b.createdAt)}</dd>
        <dt>Estimated network fee</dt>
        <dd>
          {b.feeEstimate
            ? `${sol(b.feeEstimate, 9)} SOL`
            : "Calculated at preparation"}
        </dd>
        {b.signature && (
          <>
            <dt>Original signature</dt>
            <dd>
              <code>{b.signature}</code>
              <CopyButton value={b.signature} />
            </dd>
          </>
        )}
      </dl>
      {b.rows.map((r) => (
        <div className="balance-change" key={r.address}>
          <code>{r.address}</code>
          <b>{sol(r.lamports, 9)} SOL</b>
        </div>
      ))}
      <p className="plain-note">
        {b.status === "finalized"
          ? "Exact finalized transfers and the unique CLACK batch memo verified."
          : b.status === "submitted"
            ? "Submission is not proof of payment. Recover this signature; do not create another payment while its result is uncertain."
            : b.status === "failed"
              ? "The finalized transaction failed. No transfers executed; network fees may apply."
              : "Approval transfers native SOL to the recipients above. No token approval or automatic future payment is requested."}
      </p>
      <div className="modal-actions">
        {["draft", "prepared"].includes(b.status) && (
          <button className="primary" disabled={busy} onClick={() => sign(b)}>
            <Wallet size={15} />
            {connected
              ? "Review & sign in wallet"
              : "Connect distribution wallet"}
          </button>
        )}
        {b.status === "submitted" && (
          <button className="primary" disabled={busy} onClick={() => check(b)}>
            <CheckCheck size={16} />
            Verify original transaction
          </button>
        )}
        {b.signature && (
          <External href={`https://solscan.io/tx/${b.signature}`}>
            Explorer
          </External>
        )}
        <button
          className="outline"
          onClick={() => download(b, `clack-batch-${b.id}.json`)}
        >
          <Download size={15} />
          Export batch
        </button>
      </div>
    </Modal>
  );
}
function Guide({ wallets }) {
  const sections = [
    [
      "Overview",
      "CLACK is a receipt-first treasury desk for Solana. It observes designated public wallets, prepares native SOL distributions and verifies exact finalized settlement transactions. The pixel receipt machine follows these records; it does not generate financial activity.",
    ],
    [
      "The wallets",
      "Each registered address has a declared role. Intake records incoming and outgoing activity; distribution is the payer for approved settlement batches; reserve holds funds; operations pays infrastructure costs. A role is a public label, not an onchain spending restriction. Owners retain control of their wallets.",
    ],
    [
      "Receipts",
      "Receipts check the transaction signature, finalized status, slot, native SOL transfer instructions, fee payer and account balance changes. Transfers are not automatically identified as creator fees, trades, profits or protocol revenue. Token operations and application-specific instructions are outside this version's native SOL accounting.",
    ],
    [
      "Exact allocations",
      "A distribution defines one total in lamports and up to five distinct recipients. Shares total 10,000 basis points. Integer rounding uses the largest remainder, with input order breaking ties. The allocated lamports always add up to the total. The payer also covers network fees.",
    ],
    [
      "Signing and recovery",
      "The operator records a batch. The distribution wallet then signs one transaction containing its exact transfers and unique memo. CLACK persists the original signature before broadcasting. A timeout stays pending. A prepared transaction is not silently rebuilt; uncertain payments must be reconciled before any new payment is considered.",
    ],
    [
      "Finalized settlements",
      "A batch is finalized only after its exact signature, payer, transfer list, lamport amounts, memo and successful chain result match. A failed transaction can still pay network fees. The website does not execute automatic token purchases, burns, holder snapshots or holder distributions.",
    ],
    [
      "Live observation",
      "Scheduled checks run every five minutes in production. They observe network state and wallet history after activation. Up to two prior records may be imported separately. At most three new transactions per wallet are processed per cycle. Missing RPC data preserves the cursor; a bounded history overflow requires operator review rather than silently skipping records.",
    ],
    [
      "Data and limits",
      "The public ledger retains up to 120 wallet receipts, 120 process events and 100 settlement batches. Download records for longer retention. Wallet balance timestamps may differ. Network samples are public chain activity and are never counted as CLACK revenue. After twelve minutes without an observation, a wallet reading is stale.",
    ],
    [
      "Token identity",
      "The developer watcher starts at an explicitly activated finalized slot and accepts matching future Pump creations named CLACK. Transfers, unrelated launches and unfinalized data cannot assign the CA. No token address is invented before a verified creation or explicit operator configuration.",
    ],
    [
      "Boundaries",
      "This initial release is unaudited software, not an escrow or investment product. It does not promise revenue, payouts, token value or uninterrupted monitoring. Automatic revenue collection, trading and third-party protocol fee routing are not provided by merely registering wallets. CLACK is independent of Solana and Pump.",
    ],
  ];
  return (
    <section className="docs-layout">
      <aside>
        {sections.map(([title], i) => (
          <a key={title} href={`#method-${i}`}>
            {title}
          </a>
        ))}
      </aside>
      <article>
        {sections.map(([title, text], i) => (
          <section key={title} id={`method-${i}`}>
            <h2>{title}</h2>
            <p>{text}</p>
            {i === 1 &&
              wallets.map((w) => (
                <div className="docs-wallet" key={w.id}>
                  <strong>{w.label}</strong>
                  <External href={`https://solscan.io/account/${w.address}`}>
                    <code>{w.address}</code>
                  </External>
                </div>
              ))}
          </section>
        ))}
        <div className="docs-sources">
          <External href="https://solana.com/docs/rpc/http/gettransaction">
            Solana transaction records
          </External>
          <External href="https://solana.com/docs/core/transactions">
            Solana transactions
          </External>
          <External href="https://github.com/pump-fun/pump-public-docs">
            Pump public schemas
          </External>
        </div>
      </article>
    </section>
  );
}
createRoot(document.getElementById("root")).render(<App />);
