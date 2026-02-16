// src-ts/engine/executor.ts
import crypto from "crypto";
import fs from "fs-extra";
import type { AgentConfig, ActionResult, Intent } from "../types.js";
import { MetaClient } from "../meta-client.js";
import { appendReplay } from "../replay.js";
import { appendLog } from "../logger.js";

function idempotencyKey(intent: Intent): string {
  const raw = JSON.stringify({
    action: intent.action,
    to: intent.payload.to,
    templateName: intent.payload.templateName,
    phone: intent.phone_number_id
  });
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export async function executeIntent(intent: Intent, cfg: AgentConfig): Promise<ActionResult> {
  const api = new MetaClient(cfg);
  let output: unknown;
  const actionId = crypto.randomUUID();

  switch (intent.action) {
    case "send_template": {
      const to = String(intent.payload.to || "");
      const templateName = String(intent.payload.templateName || "");
      const language = String(intent.payload.language || "en_US");
      if (!to || !templateName) throw new Error("send_template needs payload.to and payload.templateName");
      output = await api.sendTemplate(to, templateName, language, idempotencyKey(intent));
      break;
    }
    case "list_numbers":
      output = await api.listNumbers();
      break;
    case "create_template": {
      const name = String(intent.payload.templateName || "");
      const body = String(intent.payload.templateBody || "");
      if (!name || !body) throw new Error("create_template needs payload.templateName and payload.templateBody");
      output = await api.createTemplate(name, body);
      break;
    }
    case "delete_template": {
      const name = String(intent.payload.templateName || "");
      if (!name) throw new Error("delete_template needs payload.templateName");
      output = await api.deleteTemplate(name);
      break;
    }
    case "upload_media": {
      const mediaPath = String(intent.payload.mediaPath || "");
      if (!mediaPath) throw new Error("upload_media needs payload.mediaPath");
      const buf = await fs.readFile(mediaPath);
      output = await api.uploadMedia(mediaPath.split(/[\\/]/).pop() || "upload.bin", "application/octet-stream", buf.toString("base64"));
      break;
    }
    case "get_profile":
      output = await api.getProfile();
      break;
    default:
      throw new Error(`Unsupported action: ${(intent as { action?: string }).action}`);
  }

  const result: ActionResult = {
    ok: true,
    action: intent.action,
    id: actionId,
    risk: intent.risk,
    intent,
    output,
    executedAt: new Date().toISOString()
  };

  await appendReplay(result);
  await appendLog("INFO", "executor.completed", {
    id: actionId,
    action: intent.action,
    risk: intent.risk
  });
  return result;
}
