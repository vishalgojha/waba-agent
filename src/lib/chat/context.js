class ConversationContext {
  constructor(client, language = "en") {
    this.client = client || null;
    this.language = language === "hi" ? "hi" : "en";
    this.sessionId = null;
    this.messages = [];
    this.actionResults = [];
    this.actionErrors = [];
    this.leads = [];
    this.meta = {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messagesSentToday: 0,
      activeConversations: 0,
      responseRate: 0
    };
  }

  setSessionId(id) {
    this.sessionId = id || null;
    this.touch();
  }

  setClient(client) {
    this.client = client || null;
    this.touch();
  }

  setLanguage(language) {
    this.language = language === "hi" ? "hi" : "en";
    this.touch();
  }

  touch() {
    this.meta.updatedAt = new Date().toISOString();
  }

  addMessage(role, content, extra = {}) {
    const msg = {
      id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      role,
      content: String(content || ""),
      ...extra
    };
    this.messages.push(msg);
    if (role === "agent" && extra.sent === true) this.meta.messagesSentToday += 1;
    this.touch();
    return msg;
  }

  addActionResult(action, result) {
    this.actionResults.push({
      ts: new Date().toISOString(),
      action,
      result
    });
    this.touch();
  }

  addActionError(action, error) {
    this.actionErrors.push({
      ts: new Date().toISOString(),
      action,
      error: String(error?.message || error)
    });
    this.touch();
  }

  setLeads(leads) {
    this.leads = Array.isArray(leads) ? leads : [];
    this.touch();
  }

  upsertLeads(leads) {
    const current = new Map((this.leads || []).map((x) => [String(x.phone || ""), x]));
    for (const lead of leads || []) {
      const phone = String(lead?.phone || "");
      if (!phone) continue;
      current.set(phone, { ...current.get(phone), ...lead });
    }
    this.leads = [...current.values()];
    this.touch();
  }

  getLeadsSummary() {
    const total = this.leads.length;
    const active = this.leads.filter((x) => String(x.status || "active") === "active").length;
    const pending = this.leads.filter((x) => String(x.status || "") === "pending_followup").length;
    const qualified = this.leads.filter((x) => String(x.status || "") === "qualified").length;
    return { total, active, pending, qualified };
  }

  getActiveLeadsCount() {
    return this.getLeadsSummary().active;
  }

  getRecentMessages(limit = 10) {
    return this.messages.slice(Math.max(0, this.messages.length - limit));
  }

  getRecentActivity(limit = 8) {
    const rows = [];
    for (const r of this.actionResults.slice(-limit)) {
      const tool = r?.action?.tool || "action";
      rows.push(`${tool}: ok`);
    }
    for (const e of this.actionErrors.slice(-limit)) {
      const tool = e?.action?.tool || "action";
      rows.push(`${tool}: error`);
    }
    return rows.slice(-limit).join("; ") || "No recent actions";
  }

  getHistory(limit = 12) {
    return this.getRecentMessages(limit)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");
  }

  getScheduledCount() {
    const rows = this.actionResults.filter((x) => {
      const t = String(x?.action?.tool || "");
      return t === "schedule.add_text" || t === "schedule.add_template";
    });
    return rows.length;
  }

  getMessagesSentToday() {
    return Number(this.meta.messagesSentToday || 0);
  }

  setStatusMetrics({ activeConversations, responseRate } = {}) {
    if (Number.isFinite(activeConversations)) this.meta.activeConversations = Math.max(0, Number(activeConversations));
    if (Number.isFinite(responseRate)) this.meta.responseRate = Math.max(0, Math.min(100, Number(responseRate)));
    this.touch();
  }

  getActiveConversations() {
    return Number(this.meta.activeConversations || 0);
  }

  getResponseRate() {
    return Number(this.meta.responseRate || 0);
  }

  toJSON() {
    return {
      sessionId: this.sessionId,
      client: this.client,
      language: this.language,
      messages: this.messages,
      actionResults: this.actionResults,
      actionErrors: this.actionErrors,
      leads: this.leads,
      meta: this.meta
    };
  }

  hydrate(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    this.sessionId = snapshot.sessionId || this.sessionId;
    this.client = snapshot.client || this.client;
    this.language = snapshot.language === "hi" ? "hi" : this.language;
    this.messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    this.actionResults = Array.isArray(snapshot.actionResults) ? snapshot.actionResults : [];
    this.actionErrors = Array.isArray(snapshot.actionErrors) ? snapshot.actionErrors : [];
    this.leads = Array.isArray(snapshot.leads) ? snapshot.leads : [];
    this.meta = snapshot.meta && typeof snapshot.meta === "object" ? snapshot.meta : this.meta;
    this.touch();
  }
}

module.exports = { ConversationContext };
