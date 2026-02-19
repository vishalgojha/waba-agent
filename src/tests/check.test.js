const test = require("node:test");
const assert = require("node:assert/strict");

const { registerCheckCommands } = require("../commands/check");

test("check command registration function exists", async () => {
  assert.equal(typeof registerCheckCommands, "function");
});
