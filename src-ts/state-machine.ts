// src-ts/state-machine.ts
import { EventEmitter } from "events";
import type { ActionResult, Intent } from "./types.js";

export interface AgenticState {
  plan: Intent | null;
  queue: Intent[];
  approvals: Intent[];
  liveLogs: string[];
  results: ActionResult[];
  rollback: ActionResult[];
}

export class AgenticStateMachine extends EventEmitter {
  private state: AgenticState = {
    plan: null,
    queue: [],
    approvals: [],
    liveLogs: [],
    results: [],
    rollback: []
  };

  snapshot(): AgenticState {
    return {
      ...this.state,
      queue: [...this.state.queue],
      approvals: [...this.state.approvals],
      liveLogs: [...this.state.liveLogs],
      results: [...this.state.results],
      rollback: [...this.state.rollback]
    };
  }

  setPlan(intent: Intent): void {
    this.state.plan = intent;
    this.state.queue = [intent];
    this.state.approvals = intent.risk === "LOW" ? [] : [intent];
    this.emit("update", this.snapshot());
  }

  pushLog(line: string): void {
    this.state.liveLogs = [line, ...this.state.liveLogs].slice(0, 50);
    this.emit("update", this.snapshot());
  }

  approveCurrent(): Intent | null {
    const current = this.state.approvals.shift() || null;
    this.emit("update", this.snapshot());
    return current;
  }

  rejectCurrent(): Intent | null {
    const current = this.state.approvals.shift() || null;
    if (current) this.pushLog(`Rejected action=${current.action}`);
    this.emit("update", this.snapshot());
    return current;
  }

  addResult(result: ActionResult): void {
    this.state.results = [result, ...this.state.results].slice(0, 50);
    this.state.rollback = [result, ...this.state.rollback].slice(0, 50);
    this.emit("update", this.snapshot());
  }
}

