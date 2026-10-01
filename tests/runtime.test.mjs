import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
test("all API handlers load without Node's experimental require-ESM bridge", () => {
  const result = execFileSync(process.execPath, ["--no-experimental-require-module", "--input-type=module", "-e", "for (const name of ['health','status','receipt','operator','tick','watch']) { const m = await import('./api/' + name + '.mjs'); if (typeof m.default !== 'function') throw Error(name); } console.log('ok');"], { cwd: new URL("../", import.meta.url), windowsHide: true, encoding: "utf8" });
  assert.match(result, /ok/);
});
