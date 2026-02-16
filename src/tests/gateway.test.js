const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs-extra");

const { isHighRiskAction, GatewaySessionManager } = require("../lib/chat/gateway");

test("gateway risk classifier marks outbound and schedule tools as high risk", () => {
  assert.equal(isHighRiskAction({ tool: "message.send_text" }), true);
  assert.equal(isHighRiskAction({ tool: "template.send" }), true);
  assert.equal(isHighRiskAction({ tool: "schedule.add_text" }), true);
  assert.equal(isHighRiskAction({ tool: "memory.show" }), false);
});

test("gateway manager starts, lists, and persists a session", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "waba-gw-test-"));
  const prevHome = process.env.WABA_HOME;
  process.env.WABA_HOME = tempRoot;

  try {
    const manager = new GatewaySessionManager();
    const s = await manager.start({ client: "acme", language: "en", name: "Acme Lead Desk", phone: "+919800001234", context: "priority leads" });
    assert.ok(s.id);
    const listed = manager.list({ client: "acme" });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].client, "acme");
    assert.equal(listed[0].name, "Acme Lead Desk");

    const out = await s.sendMessage("show templates", { autoExecute: false, allowHighRisk: false });
    assert.ok(out.response);
    assert.equal(typeof out.response.message, "string");
    assert.ok(Array.isArray(out.pending_actions));

    const again = await manager.get(s.id);
    assert.ok(again);
    assert.equal(again.id, s.id);
    assert.equal(Array.isArray(again.getPendingActions()), true);
  } finally {
    process.env.WABA_HOME = prevHome;
    await fs.remove(tempRoot);
  }
});

test("gateway session tracks and executes pending action by id", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "waba-gw-test-"));
  const prevHome = process.env.WABA_HOME;
  process.env.WABA_HOME = tempRoot;

  try {
    const manager = new GatewaySessionManager();
    const s = await manager.start({ client: "acme", language: "en" });

    s.queueActions([
      { tool: "memory.show", params: { client: "acme", limit: 5 }, description: "Show memory" }
    ]);
    const pending = s.getPendingActions();
    assert.equal(pending.length, 1);
    assert.ok(pending[0].id);

    const execution = await s.executePendingById(pending[0].id, { allowHighRisk: false });
    assert.equal(execution.total, 1);
    assert.equal(execution.ok, 1);
    assert.equal(s.getPendingActions().length, 0);
  } finally {
    process.env.WABA_HOME = prevHome;
    await fs.remove(tempRoot);
  }
});
