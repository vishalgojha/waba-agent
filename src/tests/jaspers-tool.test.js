const test = require("node:test");
const assert = require("node:assert/strict");

const tsBridge = require("../lib/ts-bridge");
const { toolJaspersPlanReply } = require("../lib/tools/builtins/tool-jaspers-plan-reply");

test("jaspers.plan_reply validates input", async () => {
  const tool = toolJaspersPlanReply();
  const ctx = { client: "default", appendMemory: async () => {} };

  await assert.rejects(() => tool.execute(ctx, { text: "hello" }), /Missing `from`/);
  await assert.rejects(() => tool.execute(ctx, { from: "9198", text: "" }), /Missing `text`/);
});

test("jaspers.plan_reply returns plan and persists session via bridge", async () => {
  const original = tsBridge.loadTsJaspersBridge;
  const saved = [];
  const memory = [];

  tsBridge.loadTsJaspersBridge = async () => ({
    async getMarketSession(phone) {
      return saved.find((s) => s.phone === phone) || null;
    },
    async saveMarketSession(session) {
      saved.push(session);
    },
    planMarketReply(text, phone, prev) {
      return {
        stage: prev ? "selected" : "qualified",
        risk: prev ? "HIGH" : "MEDIUM",
        replyText: `planned:${text}`,
        recommendations: [{ code: "P1", name: "Rose Bouquet Classic", category: "bouquet", priceInr: 799, tags: [] }],
        nextSession: { phone, updatedAt: "2026-02-19T00:00:00.000Z", stage: prev ? "selected" : "qualified" }
      };
    }
  });

  try {
    const tool = toolJaspersPlanReply();
    const ctx = {
      client: "acme",
      appendMemory: async (_client, event) => memory.push(event)
    };

    const out = await tool.execute(ctx, { from: "919812345678", text: "birthday under 1000" });
    assert.equal(out.ok, true);
    assert.equal(out.result.stage, "qualified");
    assert.equal(saved.length, 1);
    assert.equal(memory.length, 1);
    assert.equal(memory[0].type, "jaspers_plan");
  } finally {
    tsBridge.loadTsJaspersBridge = original;
  }
});
