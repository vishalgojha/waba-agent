// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs-extra");

const { ConversationContext } = require("../lib/chat/context");
const { parseLeadAnnouncement, parseFollowupIntent, parseLanguageIntent } = require("../lib/chat/lead-handler");
const { resolveRunAt } = require("../lib/chat/scheduler");
const { WhatsAppAgent, getAiSetupHint } = require("../lib/chat/agent");

test("lead handler parsers identify common intents", () => {
  const lead = parseLeadAnnouncement("I got 5 new leads from 99acres for ACME");
  assert.equal(lead.count, 5);
  assert.equal(lead.source, "99acres");
  assert.equal(lead.client.toLowerCase(), "acme");

  const followup = parseFollowupIntent("schedule follow-up tomorrow 10am");
  assert.equal(followup.schedule, true);
  assert.ok(followup.time);

  assert.equal(parseLanguageIntent("Hindi mein bhejo"), "hi");
  assert.equal(parseLanguageIntent("reply in english"), "en");
});

test("resolveRunAt parses relative schedule inputs", () => {
  const runAt = resolveRunAt("tomorrow 10am");
  assert.ok(runAt, "expected parsed runAt");
  assert.ok(Date.parse(runAt) > Date.now());
});

test("conversation context tracks messages and lead summary", () => {
  const ctx = new ConversationContext("acme", "en");
  ctx.addMessage("user", "hello");
  ctx.addMessage("agent", "hi there");
  ctx.upsertLeads([
    { phone: "+919800001001", status: "active" },
    { phone: "+919800001002", status: "pending_followup" },
    { phone: "+919800001003", status: "qualified" }
  ]);

  const summary = ctx.getLeadsSummary();
  assert.equal(summary.total, 3);
  assert.equal(summary.active, 1);
  assert.equal(summary.pending, 1);
  assert.equal(summary.qualified, 1);
});

test("persistent chat memory saves and loads session snapshot", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "waba-chat-test-"));
  const prevHome = process.env.WABA_HOME;
  process.env.WABA_HOME = tempRoot;

  try {
    const { PersistentMemory } = require("../lib/chat/memory");
    const sessionId = `chat-test-${Date.now()}`;
    const ctx = new ConversationContext("acme", "hi");
    ctx.setSessionId(sessionId);
    ctx.addMessage("user", "test");
    ctx.addMessage("agent", "ok");

    const mem = new PersistentMemory(sessionId, "acme");
    await mem.save(ctx);
    assert.equal(await mem.exists(), true);

    const loaded = new ConversationContext("acme", "en");
    await mem.load(loaded);
    assert.equal(loaded.language, "hi");
    assert.equal(loaded.messages.length, 2);

    const history = await PersistentMemory.history({ client: "acme", limit: 5 });
    assert.ok(history.length >= 1);
    assert.equal(history[0].sessionId, sessionId);
  } finally {
    process.env.WABA_HOME = prevHome;
    await fs.remove(tempRoot);
  }
});

test("ai setup hint includes ollama + major hosted providers", () => {
  const hint = getAiSetupHint("en");
  assert.match(hint, /deepseek-coder-v2:16b/);
  assert.match(hint, /qwen2\.5:7b/);
  assert.match(hint, /ANTHROPIC_API_KEY/);
  assert.match(hint, /XAI_API_KEY/);
  assert.match(hint, /OPENROUTER_API_KEY/);
  assert.match(hint, /OPENAI_BASE_URL/);
  assert.match(hint, /WABA_AI_PROVIDER/);
});

test("heuristic direct command parses whoami without AI", () => {
  const ctx = new ConversationContext("acme", "en");
  const agent = new WhatsAppAgent(ctx);
  const out = agent.heuristicParse("whoami", null);
  assert.ok(out);
  assert.match(out.message, /Client: acme/);
  assert.equal(Array.isArray(out.actions), true);
  assert.equal(out.actions.length, 0);
});

test("heuristic direct command parses send welcome text with phone", () => {
  const ctx = new ConversationContext("acme", "en");
  const agent = new WhatsAppAgent(ctx);
  const out = agent.heuristicParse("send welcome text to +91 98123 45678", null);
  assert.ok(out);
  assert.equal(out.actions.length, 1);
  assert.equal(out.actions[0].tool, "message.send_text");
  assert.equal(out.actions[0].params.to, "+919812345678");
});
