// file: src/tui/tui-types.ts
import type { ActionResult, Intent } from "../../src-ts/types.js";
export type { Intent } from "../../src-ts/types.js";

export type HatchRole = "user" | "assistant" | "system";

export interface TranscriptTurn {
  id: string;
  role: HatchRole;
  text: string;
  streaming?: boolean;
  ts: string;
}

export interface PlanSummary {
  action: string;
  risk: Intent["risk"];
  client: string;
  missingSlots: string[];
  intent: Intent;
}

export interface ApprovalItem {
  id: string;
  intent: Intent;
  reasonRequired: boolean;
}

export interface DomainFlowSummary {
  name: string;
  stage: string;
  risk: Intent["risk"];
  target: string;
  recommendationCodes: string[];
  preview: string;
  updatedAt: string;
}

export interface RollbackNote {
  id: string;
  action: string;
  when: string;
  replayHint: string;
}

export interface HatchState {
  sessionId: string;
  connected: boolean;
  railOpen: boolean;
  showHelp: boolean;
  showPalette: boolean;
  busy: boolean;
  input: string;
  inputHistory: string[];
  historyIndex: number;
  transcript: TranscriptTurn[];
  plan: PlanSummary | null;
  queue: Intent[];
  approvals: ApprovalItem[];
  approvalHistory: ApprovalItem[];
  results: ActionResult[];
  rollback: RollbackNote[];
  logs: string[];
  domainFlow: DomainFlowSummary | null;
  selectedResult: number;
  selectedApproval: number;
  pendingConfirmReason: string;
}

export type HatchAction =
  | { type: "set-input"; value: string }
  | { type: "push-history"; value: string }
  | { type: "history-prev" }
  | { type: "history-next" }
  | { type: "set-busy"; value: boolean }
  | { type: "toggle-rail" }
  | { type: "toggle-help" }
  | { type: "toggle-palette" }
  | { type: "push-log"; value: string }
  | { type: "set-domain-flow"; value: DomainFlowSummary | null }
  | { type: "push-turn"; value: TranscriptTurn }
  | { type: "patch-turn"; id: string; text: string; streaming?: boolean }
  | { type: "set-plan"; value: PlanSummary | null }
  | { type: "set-queue"; value: Intent[] }
  | { type: "enqueue-approval"; value: ApprovalItem }
  | { type: "dequeue-approval"; value?: ApprovalItem | null }
  | { type: "set-results"; value: ActionResult[] }
  | { type: "push-result"; value: ActionResult }
  | { type: "push-rollback"; value: RollbackNote }
  | { type: "select-result"; delta: number }
  | { type: "select-approval"; delta: number }
  | { type: "set-confirm-reason"; value: string }
  | { type: "bootstrap"; value: Partial<HatchState> };

export interface SlashCommandResult {
  handled: boolean;
  message?: string;
}
