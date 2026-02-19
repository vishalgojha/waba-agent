// src-ts/engine/parser.ts
import { classifyRisk } from "./risk.js";
import type { ActionName, Intent } from "../types.js";
import { validateIntent } from "./schema.js";

function pickAction(text: string): ActionName {
  const t = text.toLowerCase();
  if (t.includes("send text")) return "send_text";
  if (t.includes("send")) return "send_template";
  if (t.includes("numbers")) return "list_numbers";
  if (t.includes("create template")) return "create_template";
  if (t.includes("delete template")) return "delete_template";
  if (t.includes("upload")) return "upload_media";
  return "get_profile";
}

function match(text: string, re: RegExp): string | undefined {
  return re.exec(text)?.[1]?.trim();
}

export function parseIntent(text: string, defaults: { businessId: string; phoneNumberId: string }): Intent {
  const action = pickAction(text);
  const templateName = match(text, /template\s+([a-z0-9_.-]+)/i);
  const to = match(text, /to\s+(\+?\d{8,15})/i);
  const mediaPath = match(text, /file\s+([^\s]+)/i);

  const intent: Intent = {
    action,
    business_id: defaults.businessId,
    phone_number_id: defaults.phoneNumberId,
    payload: {
      ...(templateName ? { templateName } : {}),
      ...(to ? { to } : {}),
      ...(mediaPath ? { mediaPath } : {})
    },
    risk: classifyRisk(action)
  };

  return validateIntent(intent);
}
