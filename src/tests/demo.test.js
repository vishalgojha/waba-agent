const test = require("node:test");
const assert = require("node:assert/strict");

const { runSmokeChecks } = require("../commands/demo");

test("demo smoke returns structured checks", async () => {
  const out = await runSmokeChecks();
  assert.equal(typeof out.ok, "boolean");
  assert.equal(typeof out.total, "number");
  assert.equal(Array.isArray(out.checks), true);
  assert.equal(out.total >= 5, true);
  assert.equal(out.checks.every((x) => typeof x.name === "string"), true);
  assert.equal(out.checks.every((x) => typeof x.pass === "boolean"), true);
});
