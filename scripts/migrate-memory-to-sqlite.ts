#!/usr/bin/env node
// @ts-nocheck
const { migrateJsonlMemoryToSqlite } = require("../src/lib/storage/migrate-memory");

async function main() {
  const out = await migrateJsonlMemoryToSqlite({
    dryRun: process.argv.includes("--dry-run")
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exitCode = 1;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
