// src-ts/types.ts
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ActionName =
  | "send_template"
  | "send_text"
  | "list_numbers"
  | "create_template"
  | "delete_template"
  | "upload_media"
  | "get_profile";

export interface IntentPayload {
  to?: string;
  body?: string;
  previewUrl?: boolean;
  templateName?: string;
  language?: string;
  templateBody?: string;
  mediaPath?: string;
  [key: string]: unknown;
}

export interface Intent {
  action: ActionName;
  business_id: string;
  phone_number_id: string;
  payload: IntentPayload;
  risk: RiskLevel;
}

export interface AgentConfig {
  token: string;
  businessId: string;
  phoneNumberId: string;
  webhookVerifyToken?: string;
  webhookUrl?: string;
  testRecipient?: string;
  testTemplate?: string;
  graphVersion: string;
  baseUrl: string;
}

export interface ScopeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  tokenValidity: ScopeCheck;
  requiredScopes: ScopeCheck;
  phoneAccess: ScopeCheck;
  webhookConnectivity: ScopeCheck;
  testSendCapability: ScopeCheck;
  rateLimits: ScopeCheck;
  overall: "PASS" | "WARN" | "FAIL";
}

export interface ActionResult {
  ok: boolean;
  action: ActionName;
  id: string;
  risk: RiskLevel;
  intent: Intent;
  output: unknown;
  executedAt: string;
}
