const { createHttpClient } = require("./http");
const { toGraphError } = require("./graph-error");

function normalizeGraphVersion(v) {
  if (!v) return "v20.0";
  const s = String(v).trim();
  if (s.startsWith("v")) return s;
  return `v${s}`;
}

function buildBaseURL({ baseUrl, graphVersion }) {
  const root = (baseUrl || "https://graph.facebook.com").replace(/\/+$/, "");
  const ver = normalizeGraphVersion(graphVersion);
  return `${root}/${ver}`;
}

function buildTemplateComponents(params) {
  if (!params) return undefined;

  // Accepted shapes:
  // 1) ["A","B"] -> body params
  // 2) { body: ["A"], header: { type: "text", value: "X" }, buttons: [...] }
  // 3) { body: [{type:"text",text:"A"}], ... } (passthrough-ish)

  const isArray = Array.isArray(params);
  const obj = isArray ? { body: params } : params;

  const components = [];

  if (obj.header) {
    if (typeof obj.header === "string") {
      components.push({
        type: "header",
        parameters: [{ type: "text", text: obj.header }]
      });
    } else if (obj.header?.type === "text") {
      components.push({
        type: "header",
        parameters: [{ type: "text", text: String(obj.header.value ?? "") }]
      });
    } else if (obj.header?.parameters) {
      components.push({ type: "header", parameters: obj.header.parameters });
    }
  }

  if (obj.body) {
    const bodyParams = obj.body.map((p) => {
      if (p && typeof p === "object" && p.type) return p; // already a parameter object
      return { type: "text", text: String(p) };
    });
    components.push({ type: "body", parameters: bodyParams });
  }

  if (obj.buttons) {
    // Advanced usage: pass through, validate lightly.
    for (const b of obj.buttons) {
      if (!b || typeof b !== "object") continue;
      components.push(b);
    }
  }

  return components.length ? components : undefined;
}

class WhatsAppCloudApi {
  constructor({ token, phoneNumberId, wabaId, graphVersion, baseUrl, timeoutMs }) {
    this.token = token;
    this.phoneNumberId = phoneNumberId;
    this.wabaId = wabaId;
    this.graphVersion = normalizeGraphVersion(graphVersion);
    this.baseURL = buildBaseURL({ baseUrl, graphVersion: this.graphVersion });
    this.http = createHttpClient({ baseURL: this.baseURL, token, timeoutMs });
  }

  async listTemplates({ limit = 50 } = {}) {
    if (!this.wabaId) throw new Error("Missing business (WABA) ID. Set via `waba auth login --business-id ...`.");
    try {
      const res = await this.http.get(`/${this.wabaId}/message_templates`, {
        params: {
          // Fields vary over time; keep this superset best-effort.
          fields: "id,name,status,language,category,quality_score,components,rejected_reason,reason,last_updated_time",
          limit
        }
      });
      return res.data;
    } catch (err) {
      const { details, hint } = toGraphError(err);
      const e = new Error(`${details.message}${hint ? `\nHint: ${hint}` : ""}`);
      e.details = details;
      throw e;
    }
  }

  async createTemplate({ name, language, category, components, parameterFormat } = {}) {
    if (!this.wabaId) throw new Error("Missing business (WABA) ID. Set via `waba auth login --business-id ...`.");
    if (!name) throw new Error("Missing template name.");
    if (!language) throw new Error("Missing template language (example: en_US).");
    if (!category) throw new Error("Missing template category (MARKETING|UTILITY|AUTHENTICATION).");
    if (!Array.isArray(components) || !components.length) throw new Error("Missing template components (BODY required).");

    try {
      const payload = {
        name,
        language,
        category,
        ...(parameterFormat ? { parameter_format: parameterFormat } : {}),
        components
      };
      const res = await this.http.post(`/${this.wabaId}/message_templates`, payload);
      return res.data;
    } catch (err) {
      const { details, hint } = toGraphError(err);
      const e = new Error(`${details.message}${hint ? `\nHint: ${hint}` : ""}`);
      e.details = details;
      throw e;
    }
  }

  async getTemplateByName({ name, limit = 200 } = {}) {
    const list = await this.listTemplates({ limit });
    const rows = list?.data || [];
    const n = String(name || "").trim();
    if (!n) return null;
    return rows.find((r) => r.name === n) || null;
  }

  async sendTemplate({ to, templateName, language = "en", params }) {
    if (!this.phoneNumberId) throw new Error("Missing phone number ID. Set via `waba auth login --phone-id ...`.");
    try {
      const components = buildTemplateComponents(params);
      const payload = {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
          ...(components ? { components } : {})
        }
      };
      const res = await this.http.post(`/${this.phoneNumberId}/messages`, payload);
      return res.data;
    } catch (err) {
      const { details, hint } = toGraphError(err);
      const e = new Error(`${details.message}${hint ? `\nHint: ${hint}` : ""}`);
      e.details = details;
      throw e;
    }
  }

  async sendText({ to, body, previewUrl = false }) {
    if (!this.phoneNumberId) throw new Error("Missing phone number ID. Set via `waba auth login --phone-id ...`.");
    try {
      const payload = {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { preview_url: !!previewUrl, body: String(body) }
      };
      const res = await this.http.post(`/${this.phoneNumberId}/messages`, payload);
      return res.data;
    } catch (err) {
      const { details, hint } = toGraphError(err);
      const e = new Error(`${details.message}${hint ? `\nHint: ${hint}` : ""}`);
      e.details = details;
      throw e;
    }
  }

  async markRead({ messageId }) {
    if (!this.phoneNumberId) throw new Error("Missing phone number ID.");
    try {
      const payload = {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId
      };
      const res = await this.http.post(`/${this.phoneNumberId}/messages`, payload);
      return res.data;
    } catch (err) {
      const { details, hint } = toGraphError(err);
      const e = new Error(`${details.message}${hint ? `\nHint: ${hint}` : ""}`);
      e.details = details;
      throw e;
    }
  }

  async getMedia({ mediaId }) {
    try {
      const res = await this.http.get(`/${mediaId}`, {
        params: { fields: "url,mime_type,sha256,file_size,id" }
      });
      return res.data;
    } catch (err) {
      const { details, hint } = toGraphError(err);
      const e = new Error(`${details.message}${hint ? `\nHint: ${hint}` : ""}`);
      e.details = details;
      throw e;
    }
  }

  async downloadMedia({ url }) {
    // Media URLs require auth even though URL is returned.
    try {
      const res = await this.http.get(url, { responseType: "arraybuffer" });
      return Buffer.from(res.data);
    } catch (err) {
      const { details, hint } = toGraphError(err);
      const e = new Error(`${details.message}${hint ? `\nHint: ${hint}` : ""}`);
      e.details = details;
      throw e;
    }
  }
}

module.exports = { WhatsAppCloudApi };
