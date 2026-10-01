import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { Keypair, Transaction } from "@solana/web3.js";
import {
  createBatch,
  prepareBatch,
  publicBatch,
  validateSigned,
} from "../server/settlements.mjs";
const base = process.env.CLACK_URL || "http://127.0.0.1:5251";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch(),
  errors = [],
  results = [];
try {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(
    () => document.querySelectorAll(".receipt-row").length > 0,
  );
  await page.evaluate(() => document.fonts.ready);
  for (const width of [320, 390, 560, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    for (const [view, title] of [
      ["Counter", "Every movement"],
      ["Wallets", "The wallets"],
      ["Settlements", "The settlement desk"],
      ["Ledger", "The paper trail"],
      ["Docs", "Inside the machine"],
    ]) {
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name: view, exact: true })
        .click();
      assert.ok((await page.locator("h1").textContent()).includes(title));
      const geometry = await page.evaluate(() => {
        const out = [
          ...document.querySelectorAll(
            "main button,main input, main select, h1,h2,footer button,header button",
          ),
        ]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return (
              r.width > 0 &&
              (r.left < -1 ||
                r.right > innerWidth + 1 ||
                (e.scrollWidth > e.clientWidth + 2 &&
                  getComputedStyle(e).overflowX === "visible"))
            );
          })
          .map((e) => ({
            tag: e.tagName,
            text: e.textContent.slice(0, 70),
            width: e.clientWidth,
            scroll: e.scrollWidth,
          }));
        return {
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          out,
        };
      });
      assert.ok(
        geometry.scroll <= width + 1,
        `${view} ${width}: page overflows ${geometry.scroll}`,
      );
      assert.deepEqual(geometry.out, [], `${view} ${width}: element overflow`);
      await page.screenshot({
        path: `artifacts/${width}-${view.toLowerCase()}.png`,
        fullPage: true,
      });
      results.push({ width, view, overflow: false });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Wallets", exact: true })
    .click();
  assert.equal(await page.locator(".wallet-row").count(), 4);
  for (const role of ["Intake", "Distribution", "Reserve", "Operations"])
    assert.equal(
      await page.getByRole("heading", { name: role, exact: true }).count(),
      1,
    );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Ledger", exact: true })
    .click();
  await page.getByLabel("Filter wallet role").selectOption("reserve");
  assert.equal(await page.locator(".receipt-row").count(), 2);
  await page.getByLabel("Search receipts").fill("no-match-expected");
  assert.equal(await page.locator(".receipt-row").count(), 0);
  await page.getByLabel("Search receipts").fill("");
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  assert.equal((await jsonDownload).suggestedFilename(), "clack-ledger.json");
  await page.locator(".receipt-row").first().click();
  await page.getByRole("dialog").waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /Historical import/);
  await page.screenshot({ path: "artifacts/390-receipt.png", fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  const receiptDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Receipt", exact: true }).click();
  assert.match((await receiptDownload).suggestedFilename(), /^clack-.*\.txt$/);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page.getByRole("button", { name: "Phantom", exact: true }).click();
  assert.match(await page.getByRole("status").innerText(), /not available/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Operator", exact: true }).click();
  await page.getByLabel("Operator key").fill("wrong");
  await page.getByRole("button", { name: "Unlock controls" }).click();
  await page.getByRole("alert").filter({ hasText: "not accepted" }).waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Counter", exact: true })
    .click();
  await page.getByLabel("Inspect a transaction").fill("bad-signature");
  await page.getByRole("button", { name: "Verify & print" }).click();
  assert.match(await page.getByRole("status").innerText(), /valid Solana/);
  const snapshot = await (await page.request.get(base + "/api/status")).json();
  await page
    .getByLabel("Inspect a transaction")
    .fill(snapshot.receipts[0].signature);
  await page.getByRole("button", { name: "Verify & print" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Receipt ready" })
    .waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Open receipt", exact: true }).click();
  assert.match(
    await page.getByRole("dialog").innerText(),
    new RegExp(snapshot.receipts[0].signature),
  );
  await page.keyboard.press("Escape");
  // Isolated browser fixtures exercise signing UI without submitting any real transaction.
  const keys = [1, 2].map((n) => Keypair.fromSeed(new Uint8Array(32).fill(n))),
    payer = keys[0].publicKey.toBase58(),
    recipient = keys[1].publicKey.toBase58();
  const batch = createBatch({
    payer,
    amount: "0.0001",
    rows: [{ address: recipient, bps: 10000 }],
    note: "OFFLINE QA ONLY",
  });
  const prepared = await prepareBatch(
    batch,
    async (m) =>
      ({
        getLatestBlockhash: {
          value: { blockhash: recipient, lastValidBlockHeight: 200 },
        },
        getFeeForMessage: { value: 5000 },
        getBalance: { value: 1000000000 },
      })[m],
  );
  const tx = Transaction.from(Buffer.from(prepared.unsigned, "base64"));
  tx.sign(keys[0]);
  const signed = tx.serialize().toString("base64");
  let current = batch,
    submitted = false;
  const offline = await browser.newContext({ reducedMotion: "reduce" });
  await offline.addInitScript(
    ({ payer, bytes }) => {
      window.phantom = {
        solana: {
          publicKey: { toString: () => payer },
          connect: async () => ({ publicKey: { toString: () => payer } }),
          signTransaction: async (tx) => {
            if (tx.feePayer.toString() !== payer)
              throw Error("QA payer mismatch");
            return { serialize: () => Uint8Array.from(bytes) };
          },
        },
      };
    },
    { payer, bytes: [...tx.serialize()] },
  );
  const testPage = await offline.newPage();
  testPage.on("pageerror", (e) => errors.push(e.message));
  await testPage.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path === "/api/status")
      body = {
        ...snapshot,
        wallets: [{ ...snapshot.wallets[1], address: payer }],
        batches: [publicBatch(current)],
      };
    else if (path === "/api/operator" && route.request().method() === "GET")
      body = { authorized: true };
    else if (path === "/api/operator") {
      const input = route.request().postDataJSON();
      if (input.action === "prepare-batch") {
        current = prepared;
        body = { batch: publicBatch(prepared), unsigned: prepared.unsigned };
      } else if (input.action === "submit-batch") {
        assert.equal(input.signed, signed);
        const signature = validateSigned(prepared, input.signed);
        current = { ...prepared, status: "submitted", signature };
        submitted = true;
        body = { batch: publicBatch(current), pending: true };
      } else throw Error(`Unexpected QA action ${input.action}`);
    } else throw Error(`Unexpected QA API ${path}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await testPage.goto(base);
  await testPage.getByRole("button", { name: "Operator", exact: true }).click();
  await testPage.getByLabel("Operator key").fill("OFFLINE-FIXTURE-ONLY");
  await testPage.getByRole("button", { name: "Unlock controls" }).click();
  await testPage
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await testPage.getByRole("button", { name: "Phantom", exact: true }).click();
  await testPage
    .getByRole("navigation")
    .getByRole("button", { name: "Settlements", exact: true })
    .click();
  await testPage.locator(".batch-row").click();
  await testPage
    .getByRole("button", { name: "Review & sign in wallet", exact: true })
    .click();
  await testPage
    .getByRole("dialog")
    .getByText("Pending confirmation", { exact: true })
    .waitFor();
  assert.ok(submitted);
  await offline.close();
  const animated = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    }),
    opening = await animated.newPage();
  await opening.goto(base);
  await opening.locator(".intro canvas").waitFor();
  const firstFrame = await opening
    .locator(".intro canvas")
    .evaluate((el) => el.toDataURL());
  await opening.waitForTimeout(1100);
  const secondFrame = await opening
    .locator(".intro canvas")
    .evaluate((el) => el.toDataURL());
  assert.notEqual(firstFrame, secondFrame);
  await opening.screenshot({ path: "artifacts/intro.png" });
  await opening.getByRole("button", { name: "Skip opening" }).click();
  assert.equal(await opening.locator(".intro").count(), 0);
  const pixels = await opening.locator(".printer-scene").evaluate((el) => {
    const d = el.getContext("2d").getImageData(0, 0, el.width, el.height).data;
    let painted = 0;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4)
      if (d[i + 3]) {
        painted++;
        colors.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      }
    return { painted, colors: colors.size };
  });
  assert.ok(pixels.painted > 10000 && pixels.colors > 15);
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/qa-report.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        base,
        layouts: results,
        functional: [
          "roles",
          "filters",
          "exports",
          "receipt verification",
          "modal escape",
          "wallet unavailable",
          "invalid operator",
          "invalid signature",
          "offline signed-batch flow",
          "animated intro",
          "canvas pixels",
        ],
        pixels,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      layouts: results.length,
      functionalChecks: 11,
      canvas: pixels,
      errors,
    }),
  );
} finally {
  await browser.close();
}
