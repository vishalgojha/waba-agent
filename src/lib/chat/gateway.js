const { safeClientName } = require("../creds");
const { ConversationContext } = require("./context");
const { PersistentMemory } = require("./memory");
const { WhatsAppAgent } = require("./agent");

const HIGH_RISK_TOOLS = new Set([
  "message.send_text",
  "message.send_text_buttons",
  "template.send",
  "schedule.add_text",
  "schedule.add_template"
]);

function isHighRiskAction(action) {
  const tool = String(action?.tool || "");
  return HIGH_RISK_TOOLS.has(tool);
}

class GatewayChatSession {
  constructor({ sessionId, client, language, name = null, phone = null }) {
    this.id = sessionId || `gw-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.client = safeClientName(client || "default");
    this.language = language === "hi" ? "hi" : "en";
    this.name = name || this.client;
    this.phone = phone || null;
    this.status = "active";
    this.context = new ConversationContext(this.client, this.language);
    this.context.setSessionId(this.id);
    this.memory = new PersistentMemory(this.id, this.client);
    this.agent = new WhatsAppAgent(this.context);
    this.pendingActions = [];
    this.actionCounter = 0;
    this.ready = false;
    this.createdAt = new Date().toISOString();
    this.lastUsedAt = new Date().toISOString();
  }

  async init() {
    if (this.ready) return this;
    if (await this.memory.exists()) {
      await this.memory.load(this.context);
      this.pendingActions = Array.isArray(this.context?.meta?.pendingActions)
        ? this.context.meta.pendingActions
        : [];
      this.actionCounter = Number(this.context?.meta?.pendingActionCounter || this.pendingActions.length || 0);
      if (!this.name || this.name === this.client) this.name = this.context?.meta?.name || this.name;
      if (!this.phone) this.phone = this.context?.meta?.phone || null;
    }
    await this.agent.init();
    await this.agent.refreshLeadCache();
    this.ready = true;
    this.lastUsedAt = new Date().toISOString();
    return this;
  }

  async sendMessage(message, { autoExecute = false, allowHighRisk = false } = {}) {
    await this.init();
    this.lastUsedAt = new Date().toISOString();
    this.context.addMessage("user", message);
    const response = await this.agent.process(message);
    const queued = this.queueActions(response.actions);

    let execution = null;
    if (autoExecute && queued.length) {
      const allowed = allowHighRisk
        ? queued
        : queued.filter((a) => !isHighRiskAction(a));
      execution = await this.executeActions(allowed, { allowHighRisk });
    }

    await this.memory.save(this.context);
    return {
      response,
      execution,
      pending_actions: this.getPendingActions(),
      context: this.context.toJSON()
    };
  }

  async executeActions(actions, { allowHighRisk = false } = {}) {
    await this.init();
    const list = Array.isArray(actions) ? actions : [];
    const results = [];
    for (const action of list) {
      if (!allowHighRisk && isHighRiskAction(action)) {
        results.push({
          ok: false,
          id: action.id || null,
          tool: action.tool,
          summary: "Blocked high-risk action",
          error: "high_risk_blocked"
        });
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const out = await this.agent.execute(action);
        this.context.addActionResult(action, out);
        this.removePendingAction(action.id);
        results.push({
          ok: true,
          id: action.id || null,
          tool: action.tool,
          summary: out.summary,
          details: out.details || null
        });
      } catch (err) {
        this.context.addActionError(action, err);
        results.push({
          ok: false,
          id: action.id || null,
          tool: action.tool,
          summary: String(err?.message || err),
          error: String(err?.message || err)
        });
      }
    }
    await this.memory.save(this.context);
    return {
      total: list.length,
      ok: results.filter((x) => x.ok).length,
      failed: results.filter((x) => !x.ok).length,
      results
    };
  }

  async executePendingById(actionId, { allowHighRisk = false } = {}) {
    await this.init();
    const id = String(actionId || "");
    const action = this.pendingActions.find((x) => String(x.id) === id);
    if (!action) {
      return {
        total: 0,
        ok: 0,
        failed: 1,
        results: [{ ok: false, id, summary: "Action not found", error: "action_not_found" }]
      };
    }
    return this.executeActions([action], { allowHighRisk });
  }

  async rejectPendingById(actionId) {
    await this.init();
    const id = String(actionId || "");
    const before = this.pendingActions.length;
    this.removePendingAction(id);
    await this.memory.save(this.context);
    return { removed: before !== this.pendingActions.length, pending: this.pendingActions.length };
  }

  queueActions(actions) {
    const list = Array.isArray(actions) ? actions : [];
    const normalized = list.map((a) => {
      this.actionCounter += 1;
      const id = `act_${Date.now().toString(36)}_${this.actionCounter.toString(36)}`;
      return {
        id,
        action_id: id,
        function: String(a?.tool || ""),
        action: String(a?.tool || ""),
        fn: String(a?.tool || ""),
        tool: String(a?.tool || ""),
        description: String(a?.description || a?.tool || "Action"),
        args: a?.params && typeof a.params === "object" ? a.params : {},
        params: a?.params && typeof a.params === "object" ? a.params : {},
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString()
      };
    });
    if (normalized.length) {
      this.pendingActions.push(...normalized);
      this.context.meta.pendingActions = this.pendingActions;
      this.context.meta.pendingActionCounter = this.actionCounter;
      this.context.touch();
    }
    return normalized;
  }

  removePendingAction(actionId) {
    const id = String(actionId || "");
    this.pendingActions = this.pendingActions.filter((x) => String(x.id) !== id);
    this.context.meta.pendingActions = this.pendingActions;
    this.context.meta.pendingActionCounter = this.actionCounter;
    this.context.touch();
  }

  getPendingActions() {
    return Array.isArray(this.pendingActions) ? [...this.pendingActions] : [];
  }

  applySeedContext({ name, phone, context }) {
    if (name) this.name = String(name);
    if (phone) this.phone = String(phone);
    if (context) this.context.addMessage("system", String(context));
    this.context.meta.name = this.name;
    this.context.meta.phone = this.phone;
    this.context.touch();
  }

  getSnapshot() {
    const lastMessage = this.context.messages[this.context.messages.length - 1] || null;
    return {
      id: this.id,
      session_id: this.id,
      name: this.name,
      phone: this.phone,
      status: this.status,
      client: this.client,
      language: this.context.language,
      message_count: this.context.messages.length,
      pending_actions: this.getPendingActions(),
      pending_actions_count: this.pendingActions.length,
      executed: this.context.actionResults.length,
      last_message: lastMessage?.content || "",
      updated_at: this.lastUsedAt,
      lastUsedAt: this.lastUsedAt,
      created_at: this.createdAt,
      createdAt: this.createdAt,
      context: this.context.toJSON()
    };
  }
}

class GatewaySessionManager {
  constructor() {
    this.sessions = new Map();
  }

  async start({ sessionId, client, language, name, phone, context }) {
    const id = sessionId || `gw-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    if (this.sessions.has(id)) {
      const existing = this.sessions.get(id);
      await existing.init();
      existing.applySeedContext({ name, phone, context });
      await existing.memory.save(existing.context);
      return existing;
    }
    const s = new GatewayChatSession({ sessionId: id, client, language, name, phone });
    await s.init();
    s.applySeedContext({ name, phone, context });
    await s.memory.save(s.context);
    this.sessions.set(s.id, s);
    return s;
  }

  async get(id) {
    const key = String(id || "");
    if (!this.sessions.has(key)) return null;
    const s = this.sessions.get(key);
    await s.init();
    return s;
  }

  list({ client } = {}) {
    const c = client ? safeClientName(client) : null;
    const rows = [];
    for (const s of this.sessions.values()) {
      if (c && s.client !== c) continue;
      rows.push({
        id: s.id,
        session_id: s.id,
        name: s.name,
        status: s.status,
        phone: s.phone,
        client: s.client,
        language: s.context.language,
        message_count: s.context.messages.length,
        pending_actions: s.pendingActions.length,
        executed: s.context.actionResults.length,
        last_message: s.context.messages[s.context.messages.length - 1]?.content || "",
        created_at: s.createdAt,
        updated_at: s.lastUsedAt,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        messages: s.context.messages.length
      });
    }
    rows.sort((a, b) => Date.parse(b.lastUsedAt || "") - Date.parse(a.lastUsedAt || ""));
    return rows;
  }
}

module.exports = { GatewaySessionManager, GatewayChatSession, isHighRiskAction };
