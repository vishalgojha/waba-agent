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

type JaspersBridge = {
  planMarketReply: (text: string, from: string, prev: unknown) => {
    stage: string;
    risk: "LOW" | "MEDIUM" | "HIGH";
    replyText: string;
    recommendations: Array<{ code: string }>;
    nextSession: unknown;
  };
  getMarketSession: (from: string) => Promise<unknown>;
  saveMarketSession: (session: unknown) => Promise<void>;
};

export function parseJaspersSlashArgs(arg: string): { from: string; text: string } | null {
  const trimmed = String(arg || "").trim();
  if (!trimmed) return null;
  const [fromRaw, ...rest] = trimmed.split(/\s+/);
  const text = rest.join(" ").trim();
  const from = String(fromRaw || "").replace(/[^\d]/g, "");
  if (!from || !text) return null;
  return { from, text };
}

function mapPlanRiskToIntentRisk(risk: string): Intent["risk"] {
  const r = String(risk || "").toUpperCase();
  if (r === "HIGH") return "HIGH";
  if (r === "LOW") return "LOW";
  return "MEDIUM";
}

export function buildJaspersDraftIntent(
  cfg: { businessId?: string; phoneNumberId?: string },
  from: string,
  replyText: string,
  risk: string
): Intent {
  return validateIntent({
    action: "send_text",
    business_id: String(cfg.businessId || ""),
    phone_number_id: String(cfg.phoneNumberId || ""),
    payload: {
      to: String(from || ""),
      body: String(replyText || "")
    },
    risk: mapPlanRiskToIntentRisk(risk)
  });
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
    await ctx.streamAssistant("Commands: /help /doctor /status /config /logs /replay <id|latest> [/dry-run] /ai <intent> /jaspers <phone> <text>");
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
  if (cmd === "jaspers") {
    const parsed = parseJaspersSlashArgs(arg);
    if (!parsed) {
      await ctx.streamAssistant("Usage: /jaspers <phone> <text>");
      return { handled: true };
    }
    const tsBridge = require("../lib/ts-bridge.js") as { loadTsJaspersBridge?: () => Promise<JaspersBridge | null> };
    const loadFn = tsBridge.loadTsJaspersBridge;
    if (!loadFn) {
      await ctx.streamAssistant("Jaspers runtime unavailable.");
      return { handled: true };
    }
    const bridge = await loadFn();
    if (!bridge?.planMarketReply || !bridge?.getMarketSession || !bridge?.saveMarketSession) {
      await ctx.streamAssistant("Jaspers runtime unavailable. Run: npm run build:ts:tmp");
      return { handled: true };
    }

    const prev = await bridge.getMarketSession(parsed.from);
    const plan = bridge.planMarketReply(parsed.text, parsed.from, prev || null);
    await bridge.saveMarketSession(plan.nextSession);

    const draftIntent = buildJaspersDraftIntent(cfg, parsed.from, plan.replyText, plan.risk);
    const reasonRequired = draftIntent.risk === "HIGH";
    const approvalId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    ctx.dispatch({
      type: "set-plan",
      value: {
        action: "jaspers.plan_reply",
        risk: draftIntent.risk,
        client: cfg.businessId || "default",
        missingSlots: [],
        intent: draftIntent
      }
    });
    ctx.dispatch({
      type: "set-domain-flow",
      value: {
        name: "jaspers-market",
        stage: String(plan.stage || "unknown"),
        risk: draftIntent.risk,
        target: parsed.from,
        recommendationCodes: (plan.recommendations || []).map((x) => String(x.code)),
        preview: String(plan.replyText || "").slice(0, 220),
        updatedAt: new Date().toISOString().slice(11, 19)
      }
    });
    ctx.dispatch({ type: "set-queue", value: [draftIntent] });
    ctx.dispatch({
      type: "enqueue-approval",
      value: {
        id: approvalId,
        intent: draftIntent,
        reasonRequired
      }
    });
    ctx.dispatch({ type: "push-log", value: `jaspers_plan_created stage=${plan.stage} risk=${plan.risk} to=${parsed.from}` });
    ctx.dispatch({ type: "push-log", value: `jaspers_plan_promoted_to_send action=send_text risk=${draftIntent.risk}` });

    await ctx.streamAssistant(
      `Jaspers stage=${plan.stage} risk=${plan.risk}\nDraft reply:\n${plan.replyText}\n` +
      (reasonRequired
        ? "HIGH risk draft queued. Press e to add approval reason, then a/Enter to approve."
        : "Draft queued. Press a/Enter to approve send or r to reject.")
    );
    return { handled: true };
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
