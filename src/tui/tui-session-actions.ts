// file: src/tui/tui-session-actions.ts
import type { HatchAction, HatchState, TranscriptTurn } from "./tui-types.js";

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function makeTurn(role: TranscriptTurn["role"], text: string): TranscriptTurn {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    role,
    text,
    ts: new Date().toISOString().slice(11, 19)
  };
}

export function createInitialState(): HatchState {
  return {
    sessionId: `hatch-${Date.now()}`,
    connected: false,
    railOpen: true,
    showHelp: false,
    showPalette: false,
    busy: false,
    input: "",
    inputHistory: [],
    historyIndex: -1,
    transcript: [],
    plan: null,
    queue: [],
    approvals: [],
    approvalHistory: [],
    results: [],
    rollback: [],
    logs: [],
    selectedResult: 0,
    selectedApproval: 0,
    pendingConfirmReason: ""
  };
}

export function hatchReducer(state: HatchState, action: HatchAction): HatchState {
  switch (action.type) {
    case "bootstrap":
      return { ...state, ...action.value };
    case "set-input":
      return { ...state, input: action.value };
    case "push-history": {
      const v = action.value.trim();
      if (!v) return state;
      const next = [v, ...state.inputHistory].slice(0, 100);
      return { ...state, inputHistory: next, historyIndex: -1 };
    }
    case "history-prev": {
      if (!state.inputHistory.length) return state;
      const next = clamp(state.historyIndex + 1, 0, state.inputHistory.length - 1);
      return { ...state, historyIndex: next, input: state.inputHistory[next] || "" };
    }
    case "history-next": {
      if (!state.inputHistory.length) return state;
      const next = state.historyIndex - 1;
      if (next < 0) return { ...state, historyIndex: -1, input: "" };
      return { ...state, historyIndex: next, input: state.inputHistory[next] || "" };
    }
    case "set-busy":
      return { ...state, busy: action.value };
    case "toggle-rail":
      return { ...state, railOpen: !state.railOpen };
    case "toggle-help":
      return { ...state, showHelp: !state.showHelp };
    case "toggle-palette":
      return { ...state, showPalette: !state.showPalette };
    case "push-log":
      return { ...state, logs: [action.value, ...state.logs].slice(0, 80) };
    case "push-turn":
      return { ...state, transcript: [action.value, ...state.transcript].slice(0, 200) };
    case "patch-turn": {
      const next = state.transcript.map((t) => {
        if (t.id !== action.id) return t;
        return {
          ...t,
          text: action.text,
          ...(action.streaming !== undefined ? { streaming: action.streaming } : {})
        };
      });
      return { ...state, transcript: next };
    }
    case "set-plan":
      return { ...state, plan: action.value };
    case "set-queue":
      return { ...state, queue: action.value };
    case "enqueue-approval":
      return {
        ...state,
        approvals: [...state.approvals, action.value],
        selectedApproval: Math.max(0, state.approvals.length)
      };
    case "dequeue-approval": {
      const [head, ...tail] = state.approvals;
      const resolved = action.value ?? head ?? null;
      return {
        ...state,
        approvals: tail,
        approvalHistory: resolved ? [resolved, ...state.approvalHistory].slice(0, 100) : state.approvalHistory,
        selectedApproval: clamp(state.selectedApproval, 0, Math.max(0, tail.length - 1)),
        pendingConfirmReason: ""
      };
    }
    case "set-results":
      return { ...state, results: action.value, selectedResult: 0 };
    case "push-result":
      return { ...state, results: [action.value, ...state.results].slice(0, 200), selectedResult: 0 };
    case "push-rollback":
      return { ...state, rollback: [action.value, ...state.rollback].slice(0, 200) };
    case "select-result":
      return {
        ...state,
        selectedResult: clamp(state.selectedResult + action.delta, 0, Math.max(0, state.results.length - 1))
      };
    case "select-approval":
      return {
        ...state,
        selectedApproval: clamp(state.selectedApproval + action.delta, 0, Math.max(0, state.approvals.length - 1))
      };
    case "set-confirm-reason":
      return { ...state, pendingConfirmReason: action.value };
    default:
      return state;
  }
}

