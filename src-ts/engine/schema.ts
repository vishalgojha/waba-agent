// src-ts/engine/schema.ts
import type { ActionName, Intent, RiskLevel } from "../types.js";

const ACTIONS = new Set<ActionName>([
  "send_template",
  "list_numbers",
  "create_template",
  "delete_template",
  "upload_media",
  "get_profile"
]);

const RISKS = new Set<RiskLevel>(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export function validateIntent(input: unknown): Intent {
  if (!input || typeof input !== "object") throw new Error("Intent must be an object.");
  const v = input as Record<string, unknown>;
  const action = String(v.action || "") as ActionName;
  if (!ACTIONS.has(action)) throw new Error(`Unsupported action: ${action}`);

  const business_id = String(v.business_id || "");
  const phone_number_id = String(v.phone_number_id || "");
  if (!business_id || !phone_number_id) throw new Error("Missing business_id or phone_number_id.");

  const risk = String(v.risk || "") as RiskLevel;
  if (!RISKS.has(risk)) throw new Error(`Invalid risk: ${risk}`);

  const payload = v.payload && typeof v.payload === "object" ? (v.payload as Record<string, unknown>) : {};
  return { action, business_id, phone_number_id, payload, risk };
}

