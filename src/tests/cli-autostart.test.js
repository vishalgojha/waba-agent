const test = require("node:test");
const assert = require("node:assert/strict");

const { shouldAutoStart } = require("../lib/cli-autostart");

test("auto-start is enabled only for empty argv in interactive tty", () => {
  assert.equal(shouldAutoStart([], { stdinIsTTY: true, stdoutIsTTY: true }), true);
  assert.equal(shouldAutoStart(["chat"], { stdinIsTTY: true, stdoutIsTTY: true }), false);
  assert.equal(shouldAutoStart(["--help"], { stdinIsTTY: true, stdoutIsTTY: true }), false);
});

test("auto-start is disabled when stdin or stdout is not tty", () => {
  assert.equal(shouldAutoStart([], { stdinIsTTY: false, stdoutIsTTY: true }), false);
  assert.equal(shouldAutoStart([], { stdinIsTTY: true, stdoutIsTTY: false }), false);
});
