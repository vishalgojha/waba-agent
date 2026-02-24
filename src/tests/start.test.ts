// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");

const { summarizeReadiness, metaDashboardUrl, isDigits } = require("../commands/start");

test("start helper validates digit ids", () => {
  assert.equal(isDigits("954287247767423"), true);
  assert.equal(isDigits(" 954287247767423 "), true);
  assert.equal(isDigits("abc123"), false);
  assert.equal(isDigits(""), false);
});

test("start helper builds app dashboard URL", () => {
  assert.equal(metaDashboardUrl("845155918683148"), "https://developers.facebook.com/apps/845155918683148/");
  assert.equal(metaDashboardUrl(""), "https://developers.facebook.com/apps/");
});

test("start readiness identifies missing meta credentials", () => {
  const out = summarizeReadiness({
    webhookVerifyToken: "tok_1",
    aiProvider: "ollama"
  });
  assert.equal(out.metaReady, false);
  assert.equal(out.webhookReady, true);
  assert.equal(out.aiReady, true);
  assert.match(out.aiMode, /ollama/);
  assert.deepEqual(out.missing.includes("meta_credentials"), true);
});

test("start readiness marks fully configured setup", () => {
  const out = summarizeReadiness({
    token: "tok",
    phoneNumberId: "954287247767423",
    wabaId: "123",
    webhookVerifyToken: "vtok",
    openaiApiKey: "sk-test",
    openaiModel: "gpt-4o-mini",
    aiProvider: "openai"
  });
  assert.equal(out.metaReady, true);
  assert.equal(out.webhookReady, true);
  assert.equal(out.aiReady, true);
  assert.equal(out.missing.length, 0);
});
