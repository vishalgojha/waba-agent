// file: src/tui/tui-orchestrator.ts
import type { Intent } from "./tui-types.js";

export interface SafetyDecision {
  mode: "block_missing" | "auto_execute" | "queue_approval";
  reasonRequired: boolean;
  summary: string;
}

export function plannerLines(intent: Intent, missing: string[]): string[] {
  return [
    `action=${intent.action}`,
    `risk=${intent.risk}`,
    `missing=${missing.length ? missing.join(",") : "none"}`
  ];
}

export function safetyDecision(intent: Intent, missing: string[]): SafetyDecision {
  if (missing.length) {
    return {
      mode: "block_missing",
      reasonRequired: false,
      summary: `missing required slots: ${missing.join(", ")}`
    };
  }
  if (intent.risk === "LOW") {
    return {
      mode: "auto_execute",
      reasonRequired: false,
      summary: "LOW risk -> auto execute"
    };
  }
  return {
    mode: "queue_approval",
    reasonRequired: intent.risk === "HIGH" || intent.risk === "CRITICAL",
    summary:
      intent.risk === "MEDIUM"
        ? "MEDIUM risk -> explicit confirm"
        : `${intent.risk} risk -> elevated approval required`
  };
}
