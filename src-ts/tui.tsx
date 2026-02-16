// src-ts/tui.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import { readConfig } from "./config.js";
import { parseIntent } from "./engine/parser.js";
import { executeIntent } from "./engine/executor.js";
import { AgenticStateMachine } from "./state-machine.js";
import type { AgenticState } from "./state-machine.js";
import type { ActionResult, Intent } from "./types.js";
import { loadTuiSession, saveTuiSession } from "./tui-session.js";
import { buildConfirmLines, panelOrder, type ConfirmState, type PanelKey } from "./tui-view-model.js";
import { getReplayById } from "./replay.js";
import { validateIntent } from "./engine/schema.js";
import { assertReplayIntentHasRequiredPayload } from "./replay-guard.js";

const theme = {
  text: "#D8DEE9",
  muted: "#4C566A",
  accent: "#81A1C1",
  ok: "#A3BE8C",
  warn: "#EBCB8B",
  danger: "#BF616A",
  critical: "#B48EAD"
};

type TimelineKind = "user" | "plan" | "result" | "error" | "system";

interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  lines: string[];
  ts: string;
}

function riskColor(risk: Intent["risk"]): string {
  if (risk === "LOW") return theme.ok;
  if (risk === "MEDIUM") return theme.warn;
  if (risk === "HIGH") return theme.danger;
  return theme.critical;
}

function pushTimeline(
  setTimeline: React.Dispatch<React.SetStateAction<TimelineEntry[]>>,
  kind: TimelineKind,
  lines: string[]
): void {
  setTimeline((prev) => [
    {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      kind,
      lines,
      ts: new Date().toISOString().slice(11, 19)
    },
    ...prev
  ]);
}

function Entry({ item }: { item: TimelineEntry }) {
  const color =
    item.kind === "error"
      ? theme.danger
      : item.kind === "result"
        ? theme.ok
        : item.kind === "plan"
          ? theme.accent
          : item.kind === "user"
            ? theme.text
            : theme.muted;
  const prefix =
    item.kind === "user" ? "you" : item.kind === "plan" ? "plan" : item.kind === "result" ? "result" : item.kind;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={theme.muted}>
        [{item.ts}] {prefix}
      </Text>
      {item.lines.map((line, i) => (
        <Text key={`${item.id}-${i}`} color={color}>
          {line}
        </Text>
      ))}
    </Box>
  );
}

function Modal({
  title,
  lines,
  reason,
  onReason,
  risk
}: {
  title: string;
  lines: string[];
  reason: string;
  onReason: (v: string) => void;
  risk: Intent["risk"];
}) {
  return (
    <Box borderStyle="double" borderColor={riskColor(risk)} paddingX={1} marginTop={1} flexDirection="column">
      <Text bold color={riskColor(risk)}>
        {title}
      </Text>
      {lines.map((line, i) => (
        <Text key={`modal-${i}`} color={theme.text}>
          {line}
        </Text>
      ))}
      <Box>
        <Text color={theme.warn}>Reason: </Text>
        <TextInput value={reason} onChange={onReason} />
      </Box>
    </Box>
  );
}

async function executeReplayById(id: string, dryRun: boolean): Promise<{ lines: string[]; intent?: Intent }> {
  const cfg = await readConfig();
  const row = await getReplayById(id);
  if (!row) throw new Error(`Replay id not found: ${id}`);
  const replayIntent = row.intent || {
    action: row.action,
    business_id: cfg.businessId,
    phone_number_id: cfg.phoneNumberId,
    payload: {},
    risk: row.risk
  };
  const intent = validateIntent(replayIntent);
  assertReplayIntentHasRequiredPayload(intent);
  if (dryRun) {
    return {
      intent,
      lines: [
        `dry-run replay id=${id}`,
        `action=${intent.action} risk=${intent.risk}`,
        "guard=pass (no execution)"
      ]
    };
  }
  const out = await executeIntent(intent, cfg);
  return {
    lines: [
      `replayed id=${id} -> action=${out.action}`,
      `executed id=${out.id}`
    ]
  };
}

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const machine = useMemo(() => new AgenticStateMachine(), []);
  const [state, setState] = useState<AgenticState>(machine.snapshot());
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState("");
  const [resultSelected, setResultSelected] = useState(0);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmSource, setConfirmSource] = useState<"approval" | "rollback">("approval");
  const [focusedPanel, setFocusedPanel] = useState<PanelKey>("logs");
  const [cfgStatus, setCfgStatus] = useState({ hasToken: false, phone: "(missing)", business: "(missing)" });

  const showRail = (stdout?.columns || 120) >= 110;

  useEffect(() => {
    void (async () => {
      const saved = await loadTuiSession();
      if (saved) {
        setFocusedPanel(saved.focusedPanel);
        setInput(saved.lastPrompt);
      }
      const cfg = await readConfig();
      setCfgStatus({
        hasToken: !!cfg.token,
        phone: cfg.phoneNumberId || "(missing)",
        business: cfg.businessId || "(missing)"
      });
      pushTimeline(setTimeline, "system", ["chat-first operator console ready"]);
    })();
  }, []);

  useEffect(() => {
    const onUpdate = (next: AgenticState) => setState(next);
    machine.on("update", onUpdate);
    return () => {
      machine.off("update", onUpdate);
    };
  }, [machine]);

  useEffect(() => {
    void saveTuiSession({ focusedPanel, lastPrompt: input });
  }, [focusedPanel, input]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1800);
  };

  const cycleFocus = (dir: 1 | -1) => {
    const idx = panelOrder.indexOf(focusedPanel);
    const next = (idx + dir + panelOrder.length) % panelOrder.length;
    setFocusedPanel(panelOrder[next]);
  };

  const openConfirm = (intent: Intent, source: "approval" | "rollback") => {
    setConfirmState({ intent, stage: 1, reason: "" });
    setConfirmSource(source);
  };

  const runIntent = async (intent: Intent) => {
    const cfg = await readConfig();
    setBusy(true);
    try {
      const out = await executeIntent(intent, cfg);
      machine.addResult(out);
      machine.pushLog(`Executed ${intent.action} id=${out.id}`);
      pushTimeline(setTimeline, "result", [`action=${out.action} risk=${out.risk}`, `id=${out.id}`]);
      flash(`executed ${out.action}`);
    } catch (err) {
      const msg = String((err as Error).message || err);
      machine.pushLog(`Error: ${msg}`);
      pushTimeline(setTimeline, "error", [msg]);
      flash("execution failed");
    } finally {
      setBusy(false);
    }
  };

  useInput(async (ch, key) => {
    if (key.ctrl && ch === "c") {
      if (state.approvals.length || busy || !!confirmState) {
        flash("pending actions exist");
        return;
      }
      exit();
      return;
    }

    if (confirmState) {
      if (ch === "r") {
        if (confirmSource === "approval") machine.rejectCurrent();
        pushTimeline(setTimeline, "system", [`rejected ${confirmState.intent.action}`]);
        setConfirmState(null);
        flash("rejected");
        return;
      }
      if (key.return) {
        if (confirmState.intent.risk === "MEDIUM") {
          const intent = confirmState.intent;
          setConfirmState(null);
          await runIntent(intent);
          return;
        }
        if (confirmState.stage === 1) {
          setConfirmState({ ...confirmState, stage: 2 });
          return;
        }
        const reason = confirmState.reason.trim();
        if (confirmState.intent.risk === "HIGH" && reason.length < 6) {
          flash("reason min 6 chars");
          return;
        }
        if (confirmState.intent.risk === "CRITICAL" && !/^APPROVE:\s+.+/i.test(reason)) {
          flash("use APPROVE: <reason>");
          return;
        }
        const intent = confirmState.intent;
        pushTimeline(setTimeline, "system", [`approved ${intent.action}`, `reason=${reason || "(none)"}`]);
        setConfirmState(null);
        await runIntent(intent);
      }
      return;
    }

    if (key.tab) {
      cycleFocus(1);
      return;
    }
    if (key.upArrow) {
      if (focusedPanel === "results") {
        setResultSelected((v) => Math.max(0, v - 1));
      } else {
        cycleFocus(-1);
      }
      return;
    }
    if (key.downArrow) {
      if (focusedPanel === "results") {
        setResultSelected((v) => Math.min(Math.max(0, state.results.length - 1), v + 1));
      } else {
        cycleFocus(1);
      }
      return;
    }

    if (ch === "?" || ch === "h") {
      setHelp((v) => !v);
      return;
    }

    if (input.trim().length > 0) return;

    if (ch === "a") {
      const approved = machine.approveCurrent();
      if (!approved) {
        flash("no approvals");
        return;
      }
      openConfirm(approved, "approval");
      return;
    }
    if (ch === "r") {
      machine.rejectCurrent();
      flash("rejected");
      return;
    }
    if (ch === "d") {
      const selected = state.results[resultSelected] || state.results[0];
      if (selected) {
        pushTimeline(setTimeline, "system", [JSON.stringify(selected)]);
        flash("result details posted");
      }
      return;
    }
    if (ch === "x") {
      const selected = state.results[resultSelected] || state.results[0];
      if (!selected?.intent) {
        flash("no replayable result");
        return;
      }
      openConfirm(selected.intent, "rollback");
      flash("replay confirm opened");
      return;
    }
    if (key.return && state.approvals.length) {
      const approved = machine.approveCurrent();
      if (approved) openConfirm(approved, "approval");
    }
  });

  const onSubmit = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    pushTimeline(setTimeline, "user", [text]);

    if (text === "/help") {
      setHelp(true);
      return;
    }

    const replayMatch = /^\/replay\s+([a-f0-9-]{6,})(\s+--dry-run)?$/i.exec(text);
    if (replayMatch) {
      const id = replayMatch[1];
      const dryRun = !!replayMatch[2];
      try {
        setBusy(true);
        const out = await executeReplayById(id, dryRun);
        if (out.intent && !dryRun) openConfirm(out.intent, "rollback");
        else pushTimeline(setTimeline, "system", out.lines);
      } catch (err) {
        pushTimeline(setTimeline, "error", [String((err as Error).message || err)]);
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      const cfg = await readConfig();
      const intent = parseIntent(text, { businessId: cfg.businessId, phoneNumberId: cfg.phoneNumberId });
      machine.setPlan(intent);
      machine.pushLog(`Planned ${intent.action} risk=${intent.risk}`);
      pushTimeline(setTimeline, "plan", [
        `action=${intent.action}`,
        `risk=${intent.risk}`,
        `business=${intent.business_id} phone=${intent.phone_number_id}`
      ]);
      if (intent.risk === "LOW") await runIntent(intent);
    } catch (err) {
      pushTimeline(setTimeline, "error", [String((err as Error).message || err)]);
    }
  };

  const pending = state.approvals[0];
  const rightRailLines = [
    `client token: ${cfgStatus.hasToken ? "set" : "missing"}`,
    `phone: ${cfgStatus.phone}`,
    `business: ${cfgStatus.business}`,
    `pending approvals: ${state.approvals.length}`,
    `results: ${state.results.length}`,
    `selected result: ${resultSelected + 1}`
  ];

  return (
    <Box flexDirection="column" height={stdout?.rows || 40}>
      <Box justifyContent="space-between" borderStyle="single" borderColor={theme.muted} paddingX={1}>
        <Text bold color={theme.accent}>
          WABA AGENT CHAT OPS
        </Text>
        <Text color={cfgStatus.hasToken ? theme.ok : theme.warn}>
          {cfgStatus.hasToken ? "ready" : "setup needed"} | approvals={state.approvals.length} | mode={focusedPanel}
        </Text>
      </Box>

      <Box flexGrow={1} flexDirection="row">
        <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={theme.muted} paddingX={1} marginRight={showRail ? 1 : 0}>
          <Text color={theme.muted}>timeline</Text>
          {timeline.length ? timeline.slice(0, 18).map((item) => <Entry key={item.id} item={item} />) : <Text color={theme.muted}>No events yet.</Text>}

          {pending ? (
            <Box borderStyle="single" borderColor={riskColor(pending.risk)} paddingX={1} marginTop={1}>
              <Text color={riskColor(pending.risk)}>
                pending approval: action={pending.action} risk={pending.risk} (a/Enter approve, r reject)
              </Text>
            </Box>
          ) : null}
        </Box>

        {showRail ? (
          <Box flexDirection="column" width={34} borderStyle="round" borderColor={theme.muted} paddingX={1}>
            <Text color={theme.muted}>context</Text>
            {rightRailLines.map((line, i) => (
              <Text key={`rail-${i}`} color={theme.text}>
                {line}
              </Text>
            ))}
            <Text color={theme.muted}>shortcuts: a r d x tab h</Text>
            {state.results[resultSelected] ? (
              <Box marginTop={1} borderStyle="single" borderColor={theme.muted} paddingX={1} flexDirection="column">
                <Text color={theme.accent}>selected result</Text>
                <Text color={theme.text}>action={state.results[resultSelected].action}</Text>
                <Text color={theme.text}>risk={state.results[resultSelected].risk}</Text>
                <Text color={theme.text}>id={state.results[resultSelected].id.slice(0, 12)}</Text>
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Box>

      {confirmState ? (
        <Modal
          title={`approval ${confirmState.intent.risk}`}
          lines={buildConfirmLines(confirmState)}
          reason={confirmState.reason}
          onReason={(v) => setConfirmState((prev) => (prev ? { ...prev, reason: v } : prev))}
          risk={confirmState.intent.risk}
        />
      ) : null}

      <Box borderStyle="single" borderColor={theme.muted} paddingX={1}>
        <Text color={busy ? theme.warn : theme.text}>{busy ? "running... " : ""}{"> "}</Text>
        <TextInput value={input} onChange={setInput} onSubmit={onSubmit} />
      </Box>

      {help ? (
        <Box borderStyle="round" borderColor={theme.accent} paddingX={1}>
          <Text color={theme.accent}>
            /help | /replay {"<id>"} --dry-run | /replay {"<id>"} | a approve | r reject | d details | x replay selected result
          </Text>
        </Box>
      ) : null}

      <Box borderStyle="single" borderColor={theme.muted} paddingX={1} justifyContent="space-between">
        <Text color={theme.muted}>chat-first operator timeline</Text>
        <Text color={toast ? theme.accent : theme.muted}>{toast || "type a request, or /help"}</Text>
      </Box>
    </Box>
  );
}

export function startTui(): void {
  render(<App />);
}
