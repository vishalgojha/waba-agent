// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");

const { choosePrimaryNextCommand } = require("../commands/fix");

test("fix picks first next-step command", () => {
  const out = choosePrimaryNextCommand({
    next: {
      steps: [
        { command: "waba auth login --token ..." },
        { command: "waba setup --generate-verify-token" }
      ]
    }
  });
  assert.equal(out, "waba auth login --token ...");
});

test("fix falls back to waba check when no steps", () => {
  const out = choosePrimaryNextCommand({ next: { steps: [] } });
  assert.equal(out, "waba check");
});
