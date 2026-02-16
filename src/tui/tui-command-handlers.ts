// file: src/tui/tui-command-handlers.ts
import type React from "react";
import { readConfig } from "../../src-ts/config.js";
import { runDoctor } from "../../src-ts/doctor.js";
import { parseIntent } from "../../src-ts/engine/parser.js";
import { validateIntent } from "../../src-ts/engine/schema.js";
import { executeIntent } from "../../src-ts/engine/executor.js";
import { listReplay, getReplayById } from "../../src-ts/replay.js";
import { assertReplayIntentHasRequiredPayload } from "../../src-ts/replay-guard.js";
import { shouldFailDoctorGate } from "../../src-ts/doctor-policy.js";
import type { HatchAction, HatchState, Intent, SlashCommandResult } from "./tui-types.js";
import { makeTurn } from "./tui-session-actions.js";

export interface HandlerContext {
  dispatch: React.Dispatch<HatchAction>;
  getState: () => HatchState;
  streamAssistant: (text: string) => Promise<void>;
}

function missingSlots(intent: Intent): string[] {
  if (intent.action === "send_template") {
    const miss = [];
    if (!intent.payload.to) miss.push("to");
    if (!intent.payload.templateName) miss.push("templateName");
    return miss;
  }
  if (intent.action === "create_template") {
    const miss = [];
    if (!intent.payload.templateName) miss.push("templateName");
    if (!intent.payload.templateBody) miss.push("templateBody");
    return miss;
  }
  if (intent.action === "delete_template") return intent.payload.templateName ? [] : ["templateName"];
  if (intent.action === "upload_media") return intent.payload.mediaPath ? [] : ["mediaPath"];
  return [];
}

export async function handleSlash(raw: string, ctx: HandlerContext): Promise<SlashCommandResult> {
  const line = raw.trim();
  if (!line.startsWith("/")) return { handled: false };
  const [cmd, ...rest] = line.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  const cfg = await readConfig();

  if (cmd === "help") {
    await ctx.streamAssistant("Commands: /help /doctor /status /config /logs /replay <id|latest> [/dry-run] /ai <intent>");
    return { handled: true };
  }
  if (cmd === "status") {
    const msg = `token=${cfg.token ? "set" : "missing"} phone=${cfg.phoneNumberId || "missing"} business=${cfg.businessId || "missing"}`;
    await ctx.streamAssistant(msg);
    return { handled: true };
  }
  if (cmd === "config") {
    const redacted = {
      token: cfg.token ? "***set***" : null,
      phoneNumberId: cfg.phoneNumberId || null,
      businessId: cfg.businessId || null,
      baseUrl: cfg.baseUrl || null
    };
    await ctx.streamAssistant(JSON.stringify(redacted));
    return { handled: true };
  }
  if (cmd === "logs") {
    const logs = ctx.getState().logs.slice(0, 12);
    await ctx.streamAssistant(logs.length ? logs.join(" | ") : "No logs.");
    return { handled: true };
  }
  if (cmd === "doctor") {
    const strict = line.includes("--strict");
    const failOnWarn = line.includes("--fail-on-warn");
    const report = await runDoctor(
      {
        token: cfg.token || "",
        businessId: cfg.businessId || "",
        phoneNumberId: cfg.phoneNumberId || "",
        graphVersion: cfg.graphVersion || "v20.0",
        baseUrl: cfg.baseUrl || "https://graph.facebook.com",
        webhookUrl: cfg.webhookUrl
      },
      { scopeCheckMode: strict ? "strict" : "best-effort" }
    );
    const gateFail = shouldFailDoctorGate(report, failOnWarn);
    await ctx.streamAssistant(`doctor overall=${report.overall}${gateFail ? " (gate-fail)" : ""}`);
    ctx.dispatch({ type: "push-log", value: `doctor overall=${report.overall}` });
    return { handled: true };
  }
  if (cmd === "replay") {
    const [idArg, modeArg] = rest;
    const dry = modeArg === "--dry-run" || line.includes("--dry-run");
    const id = (idArg || "").toLowerCase() === "latest"
      ? (await listReplay(1))[0]?.id
      : idArg;
    if (!id) {
      await ctx.streamAssistant("Replay id missing. Try /replay latest or /replay <id>.");
      return { handled: true };
    }
    const row = await getReplayById(id);
    if (!row) {
      await ctx.streamAssistant(`Replay id not found: ${id}`);
      return { handled: true };
    }
    const replayIntent = row.intent || {
      action: row.action,
      business_id: cfg.businessId || "",
      phone_number_id: cfg.phoneNumberId || "",
      payload: {},
      risk: row.risk
    };
    const intent = validateIntent(replayIntent);
    assertReplayIntentHasRequiredPayload(intent);
    if (dry) {
      await ctx.streamAssistant(`dry-run replay ok action=${intent.action} risk=${intent.risk}`);
      return { handled: true };
    }
    const out = await executeIntent(intent, {
      token: cfg.token || "",
      businessId: cfg.businessId || "",
      phoneNumberId: cfg.phoneNumberId || "",
      graphVersion: cfg.graphVersion || "v20.0",
      baseUrl: cfg.baseUrl || "https://graph.facebook.com"
    });
    ctx.dispatch({ type: "push-result", value: out });
    ctx.dispatch({ type: "push-log", value: `replay executed action=${out.action} id=${out.id}` });
    await ctx.streamAssistant(`replay executed action=${out.action} id=${out.id}`);
    return { handled: true };
  }
  if (cmd === "ai") {
    if (!arg) {
      await ctx.streamAssistant("Usage: /ai <intent>");
      return { handled: true };
    }
    ctx.dispatch({ type: "push-turn", value: makeTurn("system", `ai parse: ${arg}`) });
    return { handled: false, message: arg };
  }

  await ctx.streamAssistant(`Unknown command: /${cmd}`);
  return { handled: true };
}

export async function buildPlanFromInput(text: string, ctx: HandlerContext): Promise<{ intent: Intent; missing: string[] }> {
  const cfg = await readConfig();
  const intent = parseIntent(text, { businessId: cfg.businessId || "", phoneNumberId: cfg.phoneNumberId || "" });
  const miss = missingSlots(intent);
  return { intent, missing: miss };
}
