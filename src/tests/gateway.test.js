const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs-extra");

const { isHighRiskAction, GatewaySessionManager } = require("../lib/chat/gateway");
const { startGatewayServer } = require("../server/gateway");

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

test("gateway root disables HTML caching to avoid stale UI", async () => {
  const { server } = await startGatewayServer({ host: "127.0.0.1", port: 0, client: "acme", language: "en" });
  try {
    const boundPort = server.address().port;
    const res = await fetch(`http://127.0.0.1:${boundPort}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store, no-cache, must-revalidate, proxy-revalidate");
    assert.equal(res.headers.get("pragma"), "no-cache");
    assert.equal(res.headers.get("expires"), "0");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway enforces per-client rate limit", async () => {
  const prevMax = process.env.WABA_GATEWAY_RATE_MAX;
  const prevWindow = process.env.WABA_GATEWAY_RATE_WINDOW_MS;
  process.env.WABA_GATEWAY_RATE_MAX = "2";
  process.env.WABA_GATEWAY_RATE_WINDOW_MS = "60000";

  const { server } = await startGatewayServer({ host: "127.0.0.1", port: 0, client: "acme", language: "en" });
  try {
    const boundPort = server.address().port;
    const url = `http://127.0.0.1:${boundPort}/api/health?client=acme`;

    const r1 = await fetch(url);
    assert.equal(r1.status, 200);

    const r2 = await fetch(url);
    assert.equal(r2.status, 200);

    const r3 = await fetch(url);
    assert.equal(r3.status, 429);
    assert.equal(r3.headers.get("x-ratelimit-limit"), "2");
    assert.equal(r3.headers.get("x-ratelimit-remaining"), "0");
    const body = await r3.json();
    assert.equal(body.error, "gateway_rate_limited");
  } finally {
    process.env.WABA_GATEWAY_RATE_MAX = prevMax;
    process.env.WABA_GATEWAY_RATE_WINDOW_MS = prevWindow;
    await new Promise((resolve) => server.close(resolve));
  }
});
