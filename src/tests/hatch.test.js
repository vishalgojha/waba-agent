const test = require("node:test");
const assert = require("node:assert/strict");

const { buildGatewayBaseUrl, formatPendingActions } = require("../commands/hatch");

test("hatch builds gateway base URL", () => {
  assert.equal(buildGatewayBaseUrl("127.0.0.1", 3010), "http://127.0.0.1:3010");
  assert.equal(buildGatewayBaseUrl("localhost", 9999), "http://localhost:9999");
  assert.equal(buildGatewayBaseUrl("", 0), "http://127.0.0.1:3010");
});

test("hatch formats pending actions", () => {
  const lines = formatPendingActions([
    { id: "act_1", tool: "message.send_text", description: "Send greeting" },
    { id: "act_2", tool: "schedule.add_text", description: "Schedule followup" }
  ]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /\[act_1\]/);
  assert.match(lines[0], /message\.send_text/);
  assert.match(lines[1], /Schedule followup/);
});

test("hatch pending formatter handles empty list", () => {
  const lines = formatPendingActions([]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], "No pending actions.");
});
