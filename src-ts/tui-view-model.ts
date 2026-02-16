// src-ts/tui-view-model.ts
import type { ActionResult, Intent } from "./types.js";

export type PanelKey = "plan" | "queue" | "approvals" | "logs" | "results" | "rollback";

export const panelOrder: PanelKey[] = ["plan", "queue", "approvals", "logs", "results", "rollback"];

export interface ConfirmState {
  intent: Intent;
  stage: 1 | 2;
  reason: string;
}

function riskBadge(risk: Intent["risk"]): string {
  if (risk === "LOW") return "L";
  if (risk === "MEDIUM") return "M";
  if (risk === "HIGH") return "H";
  return "C";
}

function pad(input: string, len: number): string {
  return input.length >= len ? input.slice(0, len) : `${input}${" ".repeat(len - input.length)}`;
}

export function buildQueueRows(queue: Intent[], selectedIndex: number): string[] {
  if (!queue.length) return ["No queued actions."];
  return queue.map((item, i) => {
    const marker = i === selectedIndex ? ">" : " ";
    const rowId = String(i + 1).padStart(2, "0");
    const action = pad(item.action, 16);
    return `${marker} --:-- ${action} [${riskBadge(item.risk)}] q${rowId}`;
  });
}

export function buildResultRows(results: ActionResult[], selectedIndex: number): string[] {
  if (!results.length) return ["No results yet."];
  return results.map((item, i) => {
    const marker = i === selectedIndex ? ">" : " ";
    const t = String(item.executedAt || "").slice(11, 16) || "--:--";
    const action = pad(item.action, 16);
    return `${marker} ${t} ${action} [${riskBadge(item.risk)}] ${item.id.slice(0, 8)}`;
  });
}

export function buildConfirmLines(state: ConfirmState): string[] {
  if (state.intent.risk === "MEDIUM") {
    return [
      `Confirm action: ${state.intent.action}`,
      "Press Enter to execute or r to reject."
    ];
  }
  if (state.intent.risk === "HIGH") {
    if (state.stage === 1) {
      return [
        `HIGH risk action: ${state.intent.action}`,
        "Press Enter to continue to reason step, or r to reject."
      ];
    }
    return [
      `Reason required for HIGH: ${state.intent.action}`,
      `reason: ${state.reason || "(empty)"}`,
      "Type reason and press Enter to execute."
    ];
  }
  if (state.stage === 1) {
    return [
      `CRITICAL action: ${state.intent.action}`,
      "Press Enter for elevated approval step, or r to reject."
    ];
  }
  return [
    `CRITICAL approval: ${state.intent.action}`,
    `reason: ${state.reason || "(empty)"}`,
    "Type APPROVE: <reason> then press Enter."
  ];
}
