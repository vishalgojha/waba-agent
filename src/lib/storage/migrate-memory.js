const fs = require("fs-extra");

const { contextDir } = require("../paths");
const { safeName, memoryPath } = require("../memory");
const { insertMemoryEvent, getStorageStatus } = require("../db/sqlite-store");

async function migrateJsonlMemoryToSqlite({ client = null, dryRun = false } = {}) {
  const status = getStorageStatus();
  const out = {
    ok: false,
    storage: status,
    scannedClients: 0,
    importedEvents: 0,
    skippedLines: 0,
    errors: []
  };

  if (!status.enabled) {
    out.errors.push(`sqlite unavailable: ${status.reason}`);
    return out;
  }

  if (!(await fs.pathExists(contextDir()))) {
    out.ok = true;
    return out;
  }

  const entries = await fs.readdir(contextDir(), { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const target = client ? [safeName(client)] : dirs;

  for (const c of target) {
    const p = memoryPath(c);
    if (!(await fs.pathExists(p))) continue;
    out.scannedClients += 1;
    const text = await fs.readFile(p, "utf8");
    const lines = text.split("\n").filter(Boolean);
    for (const line of lines) {
      let event = null;
      try {
        event = JSON.parse(line);
      } catch {
        out.skippedLines += 1;
        continue;
      }
      if (!event || typeof event !== "object") {
        out.skippedLines += 1;
        continue;
      }
      if (!event.ts) event.ts = new Date().toISOString();
      if (!dryRun) {
        try {
          insertMemoryEvent(c, event);
        } catch (err) {
          out.errors.push(`${c}: ${err?.message || err}`);
          continue;
        }
      }
      out.importedEvents += 1;
    }
  }

  out.ok = out.errors.length === 0;
  return out;
}

module.exports = { migrateJsonlMemoryToSqlite };
