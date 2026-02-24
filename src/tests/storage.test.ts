// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");

const { getStorageStatus } = require("../lib/db/sqlite-store");
const { migrateJsonlMemoryToSqlite } = require("../lib/storage/migrate-memory");

test("storage status returns stable shape", () => {
  const s = getStorageStatus();
  assert.equal(typeof s.enabled, "boolean");
  assert.equal(typeof s.reason, "string");
  assert.equal(typeof s.dbPath, "string");
});

test("memory migration returns structured output", async () => {
  const out = await migrateJsonlMemoryToSqlite({ dryRun: true });
  assert.equal(typeof out.ok, "boolean");
  assert.equal(typeof out.scannedClients, "number");
  assert.equal(typeof out.importedEvents, "number");
  assert.equal(Array.isArray(out.errors), true);
});
