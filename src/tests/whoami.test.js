const test = require("node:test");
const assert = require("node:assert/strict");

const { buildWhoamiView } = require("../commands/whoami");

test("whoami suggests go when ready", () => {
  const out = buildWhoamiView({
    activeClient: "acme",
    clients: {
      acme: { token: "tok", phoneNumberId: "123", wabaId: "456" }
    },
    webhookVerifyToken: "verify-token",
    openaiApiKey: "sk-test",
    openaiModel: "gpt-4o-mini"
  });
  assert.equal(out.ready, true);
  assert.equal(out.next, "waba go");
});

test("whoami suggests fix when missing setup", () => {
  const out = buildWhoamiView({
    activeClient: "default",
    clients: { default: {} }
  });
  assert.equal(out.ready, false);
  assert.equal(out.next, "waba fix");
});
