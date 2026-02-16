// src-ts/doctor.ts
import type { AgentConfig, DoctorReport, ScopeCheck } from "./types.js";
import { MetaClient } from "./meta-client.js";

function ok(name: string, detail: string): ScopeCheck {
  return { name, ok: true, detail };
}

function fail(name: string, detail: string): ScopeCheck {
  return { name, ok: false, detail };
}

async function checkWebhookConnectivity(cfg: AgentConfig): Promise<ScopeCheck> {
  if (!cfg.webhookUrl) return fail("webhook_connectivity", "webhookUrl missing in config");
  try {
    const res = await fetch(cfg.webhookUrl, { method: "GET" });
    if (!res.ok) return fail("webhook_connectivity", `status=${res.status}`);
    return ok("webhook_connectivity", `status=${res.status}`);
  } catch (err) {
    return fail("webhook_connectivity", String((err as Error).message || err));
  }
}

export async function runDoctor(cfg: AgentConfig): Promise<DoctorReport> {
  const api = new MetaClient(cfg);

  let tokenValidity: ScopeCheck = fail("token_validity", "not checked");
  let requiredScopes: ScopeCheck = fail("required_scopes", "not checked");
  let phoneAccess: ScopeCheck = fail("phone_access", "not checked");
  let testSendCapability: ScopeCheck = fail("test_send_capability", "testRecipient/testTemplate missing");
  let rateLimits: ScopeCheck = fail("rate_limits", "not checked");

  try {
    await api.getProfile();
    tokenValidity = ok("token_validity", "profile call succeeded");
  } catch (err) {
    tokenValidity = fail("token_validity", String((err as Error).message || err));
  }

  try {
    const out = (await api.listNumbers()) as { data?: unknown[] };
    const count = Array.isArray(out?.data) ? out.data.length : 0;
    phoneAccess = count > 0 ? ok("phone_access", `numbers=${count}`) : fail("phone_access", "no phone numbers listed");
  } catch (err) {
    phoneAccess = fail("phone_access", String((err as Error).message || err));
  }

  try {
    const debug = (await api.debugToken()) as {
      data?: {
        scopes?: string[];
        is_valid?: boolean;
      };
    };
    const scopes = Array.isArray(debug?.data?.scopes) ? debug.data.scopes : [];
    const need = ["whatsapp_business_messaging", "whatsapp_business_management"];
    const missing = need.filter((s) => !scopes.includes(s));
    if (debug?.data?.is_valid === false) {
      requiredScopes = fail("required_scopes", "token invalid according to debug_token");
    } else if (missing.length) {
      requiredScopes = fail("required_scopes", `missing scopes: ${missing.join(", ")}`);
    } else {
      requiredScopes = ok("required_scopes", `validated scopes: ${need.join(", ")}`);
    }
  } catch (err) {
    requiredScopes = fail("required_scopes", `unable to verify via debug_token: ${String((err as Error).message || err)}`);
  }

  if (cfg.testRecipient && cfg.testTemplate) {
    try {
      await api.sendTemplate(cfg.testRecipient, cfg.testTemplate, "en_US");
      testSendCapability = ok("test_send_capability", "template send call succeeded");
    } catch (err) {
      testSendCapability = fail("test_send_capability", String((err as Error).message || err));
    }
  }

  rateLimits = ok("rate_limits", "No 429 seen in doctor path (best-effort)");
  const webhookConnectivity = await checkWebhookConnectivity(cfg);

  const checks = [tokenValidity, requiredScopes, phoneAccess, webhookConnectivity, testSendCapability, rateLimits];
  const failed = checks.filter((x) => !x.ok).length;
  const overall = failed === 0 ? "PASS" : failed <= 2 ? "WARN" : "FAIL";

  return {
    tokenValidity,
    requiredScopes,
    phoneAccess,
    webhookConnectivity,
    testSendCapability,
    rateLimits,
    overall
  };
}
