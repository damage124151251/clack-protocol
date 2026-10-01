import test from "node:test";
import assert from "node:assert/strict";
import { handler } from "../server/http.mjs";
import { readRemote } from "../server/store.mjs";
process.env.CLACK_OPERATOR_KEY =
  "test-operator-credential-01234567890123456789";
process.env.CRON_SECRET = "test-scheduler-credential-01234567890123456789";
process.env.PUBLIC_ORIGIN = "http://127.0.0.1:5251";
async function call(path, { method = "GET", auth, origin, body } = {}) {
  const headers = {
    ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    ...(origin ? { origin } : {}),
  };
  const req = { url: path, method, headers, body };
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(raw) {
      this.body = JSON.parse(raw);
    },
  };
  await handler(req, response);
  return response;
}
test("operator and scheduler endpoints require separate long credentials", async () => {
  for (const path of ["/api/operator", "/api/tick", "/api/watch"]) {
    for (const auth of [undefined, "wrong", "test-operator-credential"])
      assert.equal((await call(path, { auth })).statusCode, 401);
  }
  assert.equal(
    (await call("/api/operator", { auth: process.env.CRON_SECRET })).statusCode,
    401,
  );
  assert.equal(
    (await call("/api/tick", { auth: process.env.CLACK_OPERATOR_KEY }))
      .statusCode,
    401,
  );
  assert.equal(
    (await call("/api/operator", { auth: process.env.CLACK_OPERATOR_KEY })).body
      .authorized,
    true,
  );
});
test("operator rejects unknown origins, methods, oversized payloads and malformed actions", async () => {
  const auth = process.env.CLACK_OPERATOR_KEY;
  assert.equal(
    (
      await call("/api/operator", {
        auth,
        method: "POST",
        origin: "https://untrusted.example",
        body: { action: "run" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call("/api/operator", { auth, method: "DELETE" })).statusCode,
    405,
  );
  assert.equal(
    (
      await call("/api/operator", {
        auth,
        method: "POST",
        body: { data: "x".repeat(13000) },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call("/api/operator", {
        auth,
        method: "POST",
        body: { action: "not-an-action" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call("/api/operator", {
        auth,
        method: "POST",
        body: { action: "set-wallet", wallet: "bad" },
      })
    ).statusCode,
    400,
  );
});
test("public receipt lookup rejects invalid signatures before RPC access", async () => {
  for (const q of ["", "?signature=bad", "?signature=http://localhost"])
    assert.equal((await call("/api/receipt" + q)).statusCode, 400);
});
test("public responses disable caching and identify the service", async () => {
  const r = await call("/api/health");
  assert.equal(r.body.service, "CLACK");
  assert.equal(r.headers["Cache-Control"], "no-store");
});
test("remote state uses a strong ETag and rejects weak concurrency tokens", async () => {
  let options;
  const r = await readRemote(async (_, config) => {
    options = config;
    return {
      blob: { etag: '"v1"' },
      stream: new Response('{"revision":1}').body,
    };
  });
  assert.equal(r.etag, '"v1"');
  assert.equal(options.useCache, false);
  assert.equal(options.headers["Accept-Encoding"], "identity");
  await assert.rejects(
    readRemote(async () => ({ blob: { etag: 'W/"v1"' } })),
    /version token/,
  );
});
