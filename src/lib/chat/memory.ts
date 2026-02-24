// @ts-nocheck
const fs = require("fs-extra");
const path = require("path");

const { contextDir } = require("../paths");
const { safeName } = require("../memory");

function sessionRoot(client) {
  return path.join(contextDir(), safeName(client || "default"), "chat-sessions");
}

function sessionPath(client, sessionId) {
  return path.join(sessionRoot(client), `${sessionId}.json`);
}

function indexPath(client) {
  return path.join(sessionRoot(client), "index.json");
}

class PersistentMemory {
  constructor(sessionId, client) {
    this.sessionId = sessionId;
    this.client = safeName(client || "default");
  }

  async exists() {
    return fs.pathExists(sessionPath(this.client, this.sessionId));
  }

  async load(context) {
    const p = sessionPath(this.client, this.sessionId);
    if (!(await fs.pathExists(p))) return false;
    const data = await fs.readJson(p);
    context.hydrate(data);
    return true;
  }

  async save(context) {
    const p = sessionPath(this.client, this.sessionId);
    await fs.ensureDir(path.dirname(p));
    const payload = {
      ...context.toJSON(),
      sessionId: this.sessionId,
      client: this.client,
      savedAt: new Date().toISOString()
    };
    await fs.writeJson(p, payload, { spaces: 2 });
    try {
      await fs.chmod(p, 0o600);
    } catch {}
    await PersistentMemory.updateIndex(this.client, this.sessionId, payload);
    return p;
  }

  static async readIndex(client) {
    const p = indexPath(client);
    if (!(await fs.pathExists(p))) return [];
    try {
      const data = await fs.readJson(p);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  static async updateIndex(client, sessionId, snapshot) {
    const rows = await PersistentMemory.readIndex(client);
    const filtered = rows.filter((x) => x.sessionId !== sessionId);
    const recentMsg = Array.isArray(snapshot.messages) && snapshot.messages.length
      ? String(snapshot.messages[snapshot.messages.length - 1].content || "").slice(0, 140)
      : "";
    filtered.push({
      sessionId,
      client,
      language: snapshot.language || "en",
      updatedAt: snapshot.savedAt || new Date().toISOString(),
      messages: Array.isArray(snapshot.messages) ? snapshot.messages.length : 0,
      recent: recentMsg
    });
    filtered.sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
    const p = indexPath(client);
    await fs.ensureDir(path.dirname(p));
    await fs.writeJson(p, filtered.slice(0, 500), { spaces: 2 });
    try {
      await fs.chmod(p, 0o600);
    } catch {}
  }

  static async history({ client, limit = 20 } = {}) {
    const c = safeName(client || "default");
    const rows = await PersistentMemory.readIndex(c);
    return rows.slice(0, Math.max(1, Math.min(500, Number(limit) || 20)));
  }

  static async latestSessionId(client) {
    const rows = await PersistentMemory.history({ client, limit: 1 });
    return rows[0]?.sessionId || null;
  }
}

module.exports = { PersistentMemory, sessionPath };
