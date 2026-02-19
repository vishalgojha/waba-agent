const test = require("node:test");
const assert = require("node:assert/strict");

const { runSmokeChecks, generateDemoNextSteps } = require("../commands/demo");

test("demo smoke returns structured checks", async () => {
  const out = await runSmokeChecks();
  assert.equal(typeof out.ok, "boolean");
  assert.equal(typeof out.total, "number");
  assert.equal(Array.isArray(out.checks), true);
  assert.equal(out.total >= 5, true);
  assert.equal(out.checks.every((x) => typeof x.name === "string"), true);
  assert.equal(out.checks.every((x) => typeof x.pass === "boolean"), true);
});

test("demo next returns ordered actionable steps", async () => {
  const out = await generateDemoNextSteps();
  assert.equal(Array.isArray(out.steps), true);
  assert.equal(out.steps.length >= 3, true);
  assert.equal(out.steps.every((x) => typeof x.id === "number"), true);
  assert.equal(out.steps.every((x) => typeof x.command === "string" && x.command.length > 0), true);
});
