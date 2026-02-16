// src-ts/meta-client.ts
import type { AgentConfig } from "./types.js";

export class MetaClient {
  constructor(private readonly cfg: AgentConfig) {}

  private base(pathname: string): string {
    const root = `${this.cfg.baseUrl.replace(/\/+$/, "")}/${this.cfg.graphVersion}`;
    return `${root}/${pathname.replace(/^\/+/, "")}`;
  }

  private async request(pathname: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(this.base(pathname), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        "Content-Type": "application/json",
        ...(init.headers || {})
      }
    });
    const txt = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(txt);
    } catch {
      data = { raw: txt };
    }
    if (!res.ok) throw new Error(`Meta API ${res.status}: ${JSON.stringify(data)}`);
    return data;
  }

  async debugToken(): Promise<unknown> {
    const q = new URLSearchParams({
      input_token: this.cfg.token,
      access_token: this.cfg.token
    }).toString();
    return this.request(`debug_token?${q}`, { method: "GET" });
  }

  async getProfile(): Promise<unknown> {
    return this.request(this.cfg.phoneNumberId, { method: "GET" });
  }

  async listNumbers(): Promise<unknown> {
    return this.request(`${this.cfg.businessId}/phone_numbers`, { method: "GET" });
  }

  async listTemplates(): Promise<unknown> {
    return this.request(`${this.cfg.businessId}/message_templates`, { method: "GET" });
  }

  async createTemplate(name: string, body: string): Promise<unknown> {
    return this.request(`${this.cfg.businessId}/message_templates`, {
      method: "POST",
      body: JSON.stringify({
        name,
        category: "UTILITY",
        language: "en_US",
        components: [{ type: "BODY", text: body }]
      })
    });
  }

  async deleteTemplate(name: string): Promise<unknown> {
    return this.request(`${this.cfg.businessId}/message_templates?name=${encodeURIComponent(name)}`, {
      method: "DELETE"
    });
  }

  async sendTemplate(to: string, templateName: string, language = "en_US", idempotencyKey?: string): Promise<unknown> {
    return this.request(`${this.cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {},
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: language }
        }
      })
    });
  }

  async uploadMedia(fileName: string, mimeType: string, contentBase64: string): Promise<unknown> {
    return this.request(`${this.cfg.phoneNumberId}/media`, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        file_name: fileName,
        type: mimeType,
        content: contentBase64
      })
    });
  }
}
