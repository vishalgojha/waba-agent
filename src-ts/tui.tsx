// src-ts/tui.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Box, render, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { readConfig } from "./config.js";
import { parseIntent } from "./engine/parser.js";
import { executeIntent } from "./engine/executor.js";
import { AgenticStateMachine } from "./state-machine.js";
import type { AgenticState } from "./state-machine.js";

function Panel({ title, lines }: { title: string; lines: string[] }) {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} width={38} minHeight={10}>
      <Text>{title}</Text>
      {lines.slice(0, 8).map((line, i) => (
        <Text key={`${title}-${i}`}>{line}</Text>
      ))}
    </Box>
  );
}

function App() {
  const machine = useMemo(() => new AgenticStateMachine(), []);
  const [state, setState] = useState<AgenticState>(machine.snapshot());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onUpdate = (next: AgenticState) => setState(next);
    machine.on("update", onUpdate);
    return () => {
      machine.off("update", onUpdate);
    };
  }, [machine]);

  useInput(async (_input, key) => {
    if (key.return && state.approvals.length) {
      const approved = machine.approveCurrent();
      if (!approved) return;
      const cfg = await readConfig();
      setBusy(true);
      try {
        const out = await executeIntent(approved, cfg);
        machine.addResult(out);
        machine.pushLog(`Executed ${approved.action} id=${out.id}`);
      } catch (err) {
        machine.pushLog(`Error: ${String((err as Error).message || err)}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (_input === "a") machine.approveCurrent();
    if (_input === "r") machine.rejectCurrent();
    if (_input === "d" && state.plan) machine.pushLog(JSON.stringify(state.plan));
  });

  const onSubmit = async () => {
    if (!input.trim()) return;
    const cfg = await readConfig();
    const intent = parseIntent(input, { businessId: cfg.businessId, phoneNumberId: cfg.phoneNumberId });
    machine.setPlan(intent);
    machine.pushLog(`Planned ${intent.action} risk=${intent.risk}`);
    setInput("");

    if (intent.risk === "LOW") {
      setBusy(true);
      try {
        const out = await executeIntent(intent, cfg);
        machine.addResult(out);
        machine.pushLog(`Executed ${intent.action} id=${out.id}`);
      } catch (err) {
        machine.pushLog(`Error: ${String((err as Error).message || err)}`);
      } finally {
        setBusy(false);
      }
    }
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Panel title="PLAN" lines={[state.plan ? JSON.stringify(state.plan) : "No plan"]} />
        <Panel title="ACTION_QUEUE" lines={state.queue.map((x) => `${x.action} (${x.risk})`)} />
        <Panel title="APPROVALS" lines={state.approvals.map((x) => `${x.action} (${x.risk})`)} />
      </Box>
      <Box>
        <Panel title="LIVE_LOGS" lines={state.liveLogs.length ? state.liveLogs : ["No logs"]} />
        <Panel title="RESULTS" lines={state.results.map((x) => `${x.action} ok=${x.ok} id=${x.id}`)} />
        <Panel title="ROLLBACK" lines={state.rollback.map((x) => `${x.id} ${x.action}`)} />
      </Box>
      <Box marginTop={1}>
        <Text>{busy ? "running... " : ""}Prompt: </Text>
        <TextInput value={input} onChange={setInput} onSubmit={onSubmit} />
      </Box>
      <Text>Enter=confirm, a=approve, r=reject, d=details</Text>
    </Box>
  );
}

export function startTui(): void {
  render(<App />);
}

