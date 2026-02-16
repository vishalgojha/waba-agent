const { createHttpClient } = require("../http");

class HatchGatewayClient {
  constructor({ baseURL, timeoutMs = 30_000 } = {}) {
    this.baseURL = String(baseURL || "").replace(/\/+$/, "");
    this.http = createHttpClient({
      baseURL: this.baseURL,
      timeoutMs,
      userAgent: "waba-hatch/0.1.1"
    });
  }

  async health() {
    const { data } = await this.http.get("/api/health");
    return data;
  }

  async config() {
    const { data } = await this.http.get("/api/config");
    return data;
  }

  async sessions({ client }) {
    const { data } = await this.http.get("/api/sessions", { params: { client } });
    return data;
  }

  async summary({ client, days = 30 }) {
    const { data } = await this.http.get("/api/summary", { params: { client, days } });
    return data;
  }

  async startSession({ sessionId = null, client, language = "en", name = null, phone = null, context = null } = {}) {
    const { data } = await this.http.post("/api/session/start", {
      sessionId,
      client,
      language,
      name,
      phone,
      context
    });
    return data;
  }

  async getSession(sessionId) {
    const { data } = await this.http.get(`/api/session/${encodeURIComponent(String(sessionId || ""))}`);
    return data;
  }

  async sendMessage(sessionId, message, { autoExecute = false, allowHighRisk = false } = {}) {
    const { data } = await this.http.post(`/api/session/${encodeURIComponent(String(sessionId || ""))}/message`, {
      message,
      autoExecute,
      allowHighRisk
    });
    return data;
  }

  async execute(sessionId, { actionId = null, actions = [], allowHighRisk = false, timeoutMs = null } = {}) {
    const { data } = await this.http.post(`/api/session/${encodeURIComponent(String(sessionId || ""))}/execute`, {
      action_id: actionId || undefined,
      actions,
      allowHighRisk,
      timeoutMs: timeoutMs || undefined
    });
    return data;
  }

  async reject(sessionId, { actionId } = {}) {
    const { data } = await this.http.post(`/api/session/${encodeURIComponent(String(sessionId || ""))}/reject`, {
      action_id: actionId
    });
    return data;
  }
}

module.exports = { HatchGatewayClient };
