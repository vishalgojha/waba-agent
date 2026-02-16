// file: src/tui/tui-event-handlers.ts
import type React from "react";
import { readConfig } from "../../src-ts/config.js";
import { executeIntent } from "../../src-ts/engine/executor.js";
import type { HatchAction, HatchState, Intent } from "./tui-types.js";
import { makeTurn } from "./tui-session-actions.js";
import { buildPlanFromInput } from "./tui-command-handlers.js";

export interface EventContext {
  dispatch: React.Dispatch<HatchAction>;
  getState: () => HatchState;
  streamAssistant: (text: string) => Promise<void>;
}

export function classifyPolicy(risk: Intent["risk"]): "auto" | "confirm" | "elevated" {
  if (risk === "LOW") return "auto";
  if (risk === "MEDIUM") return "confirm";
  return "elevated";
}

export async function executeApproved(intent: Intent, ctx: EventContext): Promise<void> {
  const cfg = await readConfig();
  const out = await executeIntent(intent, {
    token: cfg.token || "",
    businessId: cfg.businessId || "",
    phoneNumberId: cfg.phoneNumberId || "",
    graphVersion: cfg.graphVersion || "v20.0",
    baseUrl: cfg.baseUrl || "https://graph.facebook.com"
  });
  ctx.dispatch({ type: "push-result", value: out });
  ctx.dispatch({
    type: "push-rollback",
    value: {
      id: out.id,
      action: out.action,
      when: out.executedAt,
      replayHint: `/replay ${out.id}`
    }
  });
  ctx.dispatch({ type: "push-log", value: `executed action=${out.action} id=${out.id}` });
  await ctx.streamAssistant(`Done. action=${out.action} id=${out.id}`);
}

export async function handleUserText(text: string, ctx: EventContext): Promise<void> {
  ctx.dispatch({ type: "push-turn", value: makeTurn("user", text) });
  ctx.dispatch({ type: "set-busy", value: true });
  try {
    const { intent, missing } = await buildPlanFromInput(text, {
      dispatch: ctx.dispatch,
      getState: ctx.getState,
      streamAssistant: ctx.streamAssistant
    });
    ctx.dispatch({
      type: "set-plan",
      value: {
        action: intent.action,
        risk: intent.risk,
        client: intent.business_id || "default",
        missingSlots: missing,
        intent
      }
    });
    ctx.dispatch({ type: "set-queue", value: [intent] });

    if (missing.length) {
      await ctx.streamAssistant(`Missing slots: ${missing.join(", ")}. Press e to edit slots before execution.`);
      return;
    }

    const policy = classifyPolicy(intent.risk);
    if (policy === "auto") {
      await ctx.streamAssistant(`Executing low-risk action: ${intent.action}`);
      await executeApproved(intent, ctx);
      return;
    }

    ctx.dispatch({
      type: "enqueue-approval",
      value: {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        intent,
        reasonRequired: policy === "elevated"
      }
    });
    await ctx.streamAssistant(
      policy === "confirm"
        ? `Plan ready (${intent.action}). MEDIUM risk: press Enter/a to confirm, r to reject.`
        : `Plan ready (${intent.action}). HIGH risk: approval with reason required.`
    );
  } finally {
    ctx.dispatch({ type: "set-busy", value: false });
  }
}
