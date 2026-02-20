const fs = require("fs-extra");
const path = require("path");

const { sqlitePath } = require("../paths");

let state = {
  initialized: false,
  enabled: false,
  reason: "not_initialized",
  dbPath: sqlitePath(),
  db: null
};

function closeStorage() {
  try {
    if (state.db && typeof state.db.close === "function") {
      state.db.close();
    }
  } catch {}
  state = {
    initialized: false,
    enabled: false,
    reason: "not_initialized",
    dbPath: sqlitePath(),
    db: null
  };
}

function loadNodeSqlite() {
  try {
    // Node 22+ built-in module.
    // Kept dynamic for compatibility with environments where this module is unavailable.
    // eslint-disable-next-line global-require
    return require("node:sqlite");
  } catch {
    return null;
  }
}

function ensureInitialized() {
  if (state.initialized) {
    const currentPath = sqlitePath();
    if (state.dbPath === currentPath) return state;
    // WABA_HOME can change in tests/runtime; reopen DB on the new path.
    closeStorage();
  }
  state.initialized = true;

  if (String(process.env.WABA_STORAGE_DB || "").toLowerCase() === "off") {
    state.enabled = false;
    state.reason = "disabled_by_env";
    return state;
  }

  const sqlite = loadNodeSqlite();
  if (!sqlite || typeof sqlite.DatabaseSync !== "function") {
    state.enabled = false;
    state.reason = "node_sqlite_unavailable";
    return state;
  }

  try {
    const dbFile = sqlitePath();
    fs.ensureDirSync(path.dirname(dbFile));
    const db = new sqlite.DatabaseSync(dbFile);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS memory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client TEXT NOT NULL,
        ts TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_events_client_id ON memory_events(client, id);
    `);

    state.enabled = true;
    state.reason = "ok";
    state.dbPath = dbFile;
    state.db = db;
  } catch (err) {
    state.enabled = false;
    state.reason = `init_failed: ${err?.message || err}`;
  }

  return state;
}

function getStorageStatus() {
  const s = ensureInitialized();
  return {
    enabled: !!s.enabled,
    reason: s.reason,
    dbPath: s.dbPath
  };
}

function insertMemoryEvent(client, event) {
  const s = ensureInitialized();
  if (!s.enabled || !s.db) return false;
  const ts = String(event?.ts || new Date().toISOString());
  const payload = JSON.stringify(event || {});
  const stmt = s.db.prepare("INSERT INTO memory_events (client, ts, payload) VALUES (?, ?, ?)");
  stmt.run(String(client || "default"), ts, payload);
  return true;
}

function readMemoryEvents(client, { limit = 200 } = {}) {
  const s = ensureInitialized();
  if (!s.enabled || !s.db) return [];
  const lim = Math.max(1, Math.min(5000, Number(limit) || 200));
  const stmt = s.db.prepare(
    "SELECT payload FROM memory_events WHERE client = ? ORDER BY id DESC LIMIT ?"
  );
  const rows = stmt.all(String(client || "default"), lim);
  const events = [];
  for (const row of rows.reverse()) {
    try {
      events.push(JSON.parse(String(row.payload || "{}")));
    } catch {}
  }
  return events;
}

function listMemoryClients() {
  const s = ensureInitialized();
  if (!s.enabled || !s.db) return [];
  const stmt = s.db.prepare("SELECT DISTINCT client FROM memory_events ORDER BY client ASC");
  return stmt.all().map((r) => String(r.client || "")).filter(Boolean);
}

function deleteMemoryClient(client) {
  const s = ensureInitialized();
  if (!s.enabled || !s.db) return false;
  const stmt = s.db.prepare("DELETE FROM memory_events WHERE client = ?");
  stmt.run(String(client || "default"));
  return true;
}

module.exports = {
  getStorageStatus,
  insertMemoryEvent,
  readMemoryEvents,
  listMemoryClients,
  deleteMemoryClient,
  closeStorage
};
