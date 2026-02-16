const test = require("node:test");
const assert = require("node:assert/strict");

const { buildReadiness } = require("../lib/readiness");
const { aiPatchFromOptions } = require("../commands/setup");

test("readiness reports missing checks for empty config", () => {
  const out = buildReadiness({}, { client: "acme" });
  assert.equal(out.client, "acme");
  assert.equal(out.metaReady, false);
  assert.equal(out.webhookReady, false);
  assert.equal(out.overallReady, false);
  assert.ok(out.missing.includes("meta_credentials"));
  assert.ok(out.missing.includes("webhook_verify_token"));
});

test("readiness reports ready when required fields exist", () => {
  const out = buildReadiness({
    activeClient: "acme",
    webhookVerifyToken: "vtok",
    aiProvider: "openai",
    openaiApiKey: "sk-test",
    openaiModel: "gpt-4o-mini",
    clients: {
      acme: { token: "tok", phoneNumberId: "123", wabaId: "456" }
    }
  });
  assert.equal(out.metaReady, true);
  assert.equal(out.webhookReady, true);
  assert.equal(out.aiReady, true);
  assert.equal(out.overallReady, true);
});

test("setup ai patch supports ollama and hosted providers", () => {
  const ollama = aiPatchFromOptions({ aiProvider: "ollama" });
  assert.equal(ollama.aiProvider, "ollama");
  assert.ok(ollama.openaiBaseUrl);
  assert.ok(ollama.openaiModel);

  const openai = aiPatchFromOptions({ aiProvider: "openai", aiKey: "sk", aiModel: "gpt-4o-mini" });
  assert.equal(openai.aiProvider, "openai");
  assert.equal(openai.openaiApiKey, "sk");
  assert.equal(openai.openaiModel, "gpt-4o-mini");
});
