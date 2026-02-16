// src-ts/engine/risk.ts
import type { ActionName, RiskLevel } from "../types.js";

export function classifyRisk(action: ActionName): RiskLevel {
  if (action === "list_numbers" || action === "get_profile") return "LOW";
  if (action === "create_template" || action === "upload_media") return "MEDIUM";
  if (action === "send_template" || action === "delete_template") return "HIGH";
  return "CRITICAL";
}

