// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildTourSnapshot } = require("../commands/tour");

test("tour suggests go when check is ok", () => {
  const out = buildTourSnapshot(
    { client: "acme", metaConnected: true, webhookReady: true, ready: true },
    { ok: true, smoke: { passCount: 8, total: 8 } }
  );
  assert.equal(out.next, "waba go");
  assert.equal(out.check.passCount, 8);
});

test("tour suggests fix when check fails", () => {
  const out = buildTourSnapshot(
    { client: "default", metaConnected: false, webhookReady: false, ready: false },
    { ok: false, smoke: { passCount: 6, total: 8 } }
  );
  assert.equal(out.next, "waba fix");
});
