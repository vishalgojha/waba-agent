// src-ts/replay-guard.ts
import type { Intent } from "./types.js";

export function assertReplayIntentHasRequiredPayload(intent: Intent): void {
  const p = intent.payload || {};
  if (intent.action === "send_template") {
    if (!p.to || !p.templateName) {
      throw new Error("Replay blocked: send_template requires payload.to and payload.templateName.");
    }
    return;
  }
  if (intent.action === "create_template") {
    if (!p.templateName || !p.templateBody) {
      throw new Error("Replay blocked: create_template requires payload.templateName and payload.templateBody.");
    }
    return;
  }
  if (intent.action === "delete_template") {
    if (!p.templateName) throw new Error("Replay blocked: delete_template requires payload.templateName.");
    return;
  }
  if (intent.action === "upload_media") {
    if (!p.mediaPath) throw new Error("Replay blocked: upload_media requires payload.mediaPath.");
  }
}

