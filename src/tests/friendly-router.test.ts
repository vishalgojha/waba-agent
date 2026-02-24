// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveFriendlyCommand } = require("../lib/friendly-router");

const known = new Set(["check", "health", "ready", "verify", "test", "go", "start", "status", "help"]);

test("friendly router corrects typo to check", () => {
  const out = resolveFriendlyCommand(["chek"], known);
  assert.equal(out.target, "check");
  assert.deepEqual(out.rewritten, ["check"]);
});

test("friendly router maps natural words to go", () => {
  const out = resolveFriendlyCommand(["launch", "assistant"], known);
  assert.equal(out.target, "go");
  assert.deepEqual(out.rewritten, ["go"]);
});

test("friendly router returns null for known commands", () => {
  const out = resolveFriendlyCommand(["check"], known);
  assert.equal(out, null);
});
