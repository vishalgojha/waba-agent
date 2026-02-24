// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseConfigValue, setByPath, unsetByPath } = require("../commands/config");

test("config parser converts booleans, numbers, null, and JSON", () => {
  assert.equal(parseConfigValue("true"), true);
  assert.equal(parseConfigValue("false"), false);
  assert.equal(parseConfigValue("null"), null);
  assert.equal(parseConfigValue("42"), 42);
  assert.deepEqual(parseConfigValue('{"a":1}'), { a: 1 });
  assert.equal(parseConfigValue("hello"), "hello");
});

test("config path helpers set and unset nested values", () => {
  const obj = {};
  setByPath(obj, "pricing.inrPerMarketing", 0.78);
  assert.equal(obj.pricing.inrPerMarketing, 0.78);

  const removed = unsetByPath(obj, "pricing.inrPerMarketing");
  assert.equal(removed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(obj.pricing, "inrPerMarketing"), false);

  const missing = unsetByPath(obj, "pricing.notThere");
  assert.equal(missing, false);
});
