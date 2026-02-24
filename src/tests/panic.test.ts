// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");

const { sanitizeConfigForPanic, summarizePanicDiff } = require("../commands/panic");

test("panic keeps client credentials and core connectivity fields", () => {
  const input = {
    activeClient: "acme",
    clients: { acme: { token: "tok", phoneNumberId: "1", wabaId: "2" } },
    graphVersion: "v20.0",
    baseUrl: "https://graph.facebook.com",
    webhookVerifyToken: "vtok",
    aiProvider: "openai",
    openaiApiKey: "sk-test",
    randomTemp: true
  };
  const out = sanitizeConfigForPanic(input);
  assert.equal(out.activeClient, "acme");
  assert.equal(!!out.clients.acme.token, true);
  assert.equal(out.graphVersion, "v20.0");
  assert.equal(out.baseUrl, "https://graph.facebook.com");
  assert.equal(out.webhookVerifyToken, "vtok");
  assert.equal("aiProvider" in out, false);
  assert.equal("randomTemp" in out, false);
});

test("panic diff reports removed keys", () => {
  const before = { a: 1, b: 2, clients: {} };
  const after = { b: 2, clients: {} };
  const diff = summarizePanicDiff(before, after);
  assert.deepEqual(diff.removed, ["a"]);
});
