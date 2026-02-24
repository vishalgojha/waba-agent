// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");

const { renderBeginnerHelp } = require("../commands/help-me");

test("help-me renders beginner command list", () => {
  const lines = renderBeginnerHelp();
  assert.equal(Array.isArray(lines), true);
  assert.equal(lines[0], "Beginner Commands");
  assert.equal(lines.some((x) => x.includes("waba check")), true);
  assert.equal(lines.some((x) => x.includes("waba fix")), true);
  assert.equal(lines.some((x) => x.includes("waba go")), true);
});
