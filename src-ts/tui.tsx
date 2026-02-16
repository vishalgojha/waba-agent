// src-ts/tui.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import { readConfig } from "./config.js";
import { parseIntent } from "./engine/parser.js";
import { executeIntent } from "./engine/executor.js";
import { AgenticStateMachine } from "./state-machine.js";
import type { AgenticState } from "./state-machine.js";
import type { Intent } from "./types.js";
import { loadTuiSession, saveTuiSession } from "./tui-session.js";
import {
  buildConfirmLines,
  buildQueueRows,
  buildResultRows,
  panelOrder,
  type ConfirmState,
  type PanelKey
} from "./tui-view-model.js";

const theme = {
  accent: "#81A1C1",
  accentStrong: "#5E81AC",
  text: "#D8DEE9",
  muted: "#4C566A",
  ok: "#A3BE8C",
  warn: "#EBCB8B",
  danger: "#BF616A",
  critical: "#B48EAD"
};

function statusColor(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("error")) return theme.danger;
  if (m.includes("reject")) return theme.warn;
  if (m.includes("executed")) return theme.ok;
  if (m.includes("critical")) return theme.critical;
  return theme.accent;
}

function Panel({
  title,
  lines,
  focused,
  compact = false
}: {
  title: string;
  lines: string[];
  focused: boolean;
  compact?: boolean;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle={focused ? "bold" : "round"}
      borderColor={focused ? theme.accentStrong : theme.muted}
      paddingX={1}
      paddingY={0}
      width={compact ? 32 : 38}
      minHeight={compact ? 8 : 10}
      marginRight={1}
      marginBottom={1}
    >
      <Text bold color={focused ? theme.accent : theme.muted}>
        {title}
      </Text>
      {(lines.length ? lines : ["-"]).slice(0, compact ? 5 : 8).map((line, i) => (
        <Text key={`${title}-${i}`} color={theme.text} dimColor={!focused}>
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
  onReason
}: {
  title: string;
  lines: string[];
  reason: string;
  onReason: (v: string) => void;
}) {
  return (
    <Box borderStyle="double" borderColor={theme.accentStrong} paddingX={1} marginY={1} flexDirection="column">
      <Text bold color={theme.accent}>
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

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const machine = useMemo(() => new AgenticStateMachine(), []);
  const [state, setState] = useState<AgenticState>(machine.snapshot());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [focusedPanel, setFocusedPanel] = useState<PanelKey>("plan");
  const [showHelp, setShowHelp] = useState(false);
  const [toast, setToast] = useState<string>("");
  const [queueSelected, setQueueSelected] = useState(0);
  const [resultSelected, setResultSelected] = useState(0);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmSource, setConfirmSource] = useState<"approval" | "rollback">("approval");
  const [cfgStatus, setCfgStatus] = useState({ hasToken: false, phone: "(missing)", business: "(missing)" });
  const [saveTick, setSaveTick] = useState<NodeJS.Timeout | null>(null);

  const compact = (stdout?.columns || 120) < 130;
  const showSidebar = (stdout?.columns || 120) >= 110;

  useEffect(() => {
    void (async () => {
      const saved = await loadTuiSession();
      if (saved) {
        setFocusedPanel(saved.focusedPanel);
        setInput(saved.lastPrompt);
      }
    })();
  }, []);

  useEffect(() => {
    if (saveTick) clearTimeout(saveTick);
    const t = setTimeout(() => {
      void saveTuiSession({ focusedPanel, lastPrompt: input });
    }, 300);
    setSaveTick(t);
    return () => clearTimeout(t);
  }, [focusedPanel, input]);

  useEffect(() => {
    const onUpdate = (next: AgenticState) => setState(next);
    machine.on("update", onUpdate);
    return () => {
      machine.off("update", onUpdate);
    };
  }, [machine]);

  useEffect(() => {
    void (async () => {
      const cfg = await readConfig();
      setCfgStatus({
        hasToken: !!cfg.token,
        phone: cfg.phoneNumberId || "(missing)",
        business: cfg.businessId || "(missing)"
      });
    })();
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1700);
  };

  const cycleFocus = (dir: 1 | -1) => {
    const idx = panelOrder.indexOf(focusedPanel);
    const next = (idx + dir + panelOrder.length) % panelOrder.length;
    setFocusedPanel(panelOrder[next]);
  };

  const startApprovalModal = (intent: Intent, source: "approval" | "rollback") => {
    setConfirmState({ intent, stage: 1, reason: "" });
    setConfirmSource(source);
  };

  const executeApproved = async (intent: Intent) => {
    const cfg = await readConfig();
    setBusy(true);
    try {
      const out = await executeIntent(intent, cfg);
      machine.addResult(out);
      machine.pushLog(`Executed ${intent.action} id=${out.id}`);
      flash(`Executed ${intent.action}`);
    } catch (err) {
      machine.pushLog(`Error: ${String((err as Error).message || err)}`);
      flash("Execution failed");
    } finally {
      setBusy(false);
    }
  };

  useInput(async (ch, key) => {
    if (key.ctrl && ch === "c") {
      if (state.approvals.length || busy || !!confirmState) {
        flash("Pending work exists. Clear approvals/modal first.");
        return;
      }
      exit();
      return;
    }

    if (confirmState) {
      if (ch === "r") {
        if (confirmSource === "approval") machine.rejectCurrent();
        setConfirmState(null);
        flash("Approval rejected");
        return;
      }
      if (key.return) {
        if (confirmState.intent.risk === "MEDIUM") {
          setConfirmState(null);
          await executeApproved(confirmState.intent);
          return;
        }
        if (confirmState.stage === 1) {
          setConfirmState({ ...confirmState, stage: 2 });
          flash(confirmState.intent.risk === "CRITICAL" ? "Critical reason required" : "Reason required");
          return;
        }

        const reason = confirmState.reason.trim();
        if (confirmState.intent.risk === "HIGH" && reason.length < 6) {
          flash("Provide a longer reason (min 6 chars)");
          return;
        }
        if (confirmState.intent.risk === "CRITICAL" && !/^APPROVE:\s+.+/i.test(reason)) {
          flash("Use format: APPROVE: <reason>");
          return;
        }
        machine.pushLog(`Approved ${confirmState.intent.action} reason="${reason}"`);
        setConfirmState(null);
        if (confirmSource === "rollback") {
          machine.pushLog(`Replay approved for ${confirmState.intent.action}`);
        }
        await executeApproved(confirmState.intent);
      }
      return;
    }

    if (key.tab) {
      cycleFocus(1);
      return;
    }
    if (key.leftArrow || key.upArrow) {
      if (focusedPanel === "queue") {
        setQueueSelected((v) => Math.max(0, v - 1));
        return;
      }
      if (focusedPanel === "results") {
        setResultSelected((v) => Math.max(0, v - 1));
        return;
      }
      cycleFocus(-1);
      return;
    }
    if (key.rightArrow || key.downArrow) {
      if (focusedPanel === "queue") {
        setQueueSelected((v) => Math.min(Math.max(0, state.queue.length - 1), v + 1));
        return;
      }
      if (focusedPanel === "results") {
        setResultSelected((v) => Math.min(Math.max(0, state.results.length - 1), v + 1));
        return;
      }
      cycleFocus(1);
      return;
    }
    if (ch === "?" || ch === "h") {
      setShowHelp((v) => !v);
      return;
    }

    // While typing prompt, avoid single-key action handlers.
    if (input.trim().length > 0) return;

    if (key.return && state.approvals.length) {
      const approved = machine.approveCurrent();
      if (!approved) return;
      startApprovalModal(approved, "approval");
      return;
    }
    if (ch === "a") {
      const approved = machine.approveCurrent();
      if (!approved) {
        flash("No pending approvals");
        return;
      }
      startApprovalModal(approved, "approval");
      return;
    }
    if (ch === "r") {
      machine.rejectCurrent();
      flash("Approval rejected");
      return;
    }
    if (ch === "d") {
      if (focusedPanel === "results" && state.results[resultSelected]) {
        machine.pushLog(JSON.stringify(state.results[resultSelected], null, 0));
        flash("Result details pushed to logs");
      } else if (state.plan) {
        machine.pushLog(JSON.stringify(state.plan));
        flash("Plan details pushed to logs");
      }
      return;
    }
    if (ch === "x" && focusedPanel === "results") {
      const selected = state.results[resultSelected];
      if (!selected?.intent) {
        flash("Selected result has no replayable intent");
        return;
      }
      startApprovalModal(selected.intent, "rollback");
      flash("Replay confirmation opened");
    }
  });

  const onSubmit = async () => {
    if (!input.trim()) return;
    const cfg = await readConfig();
    const intent = parseIntent(input, { businessId: cfg.businessId, phoneNumberId: cfg.phoneNumberId });
    machine.setPlan(intent);
    machine.pushLog(`Planned ${intent.action} risk=${intent.risk}`);
    setInput("");
    setQueueSelected(0);

    if (intent.risk === "LOW") {
      await executeApproved(intent);
    }
  };

  const summary = {
    approvals: state.approvals.length,
    results: state.results.length,
    logs: state.liveLogs.length
  };

  const navLines = [
    `PLAN${focusedPanel === "plan" ? " <-" : ""}`,
    `ACTION_QUEUE${focusedPanel === "queue" ? " <-" : ""}`,
    `APPROVALS${focusedPanel === "approvals" ? " <-" : ""}`,
    `LIVE_LOGS${focusedPanel === "logs" ? " <-" : ""}`,
    `RESULTS${focusedPanel === "results" ? " <-" : ""}`,
    `ROLLBACK${focusedPanel === "rollback" ? " <-" : ""}`
  ];

  const queueRows = buildQueueRows(state.queue, queueSelected);
  const resultRows = buildResultRows(state.results, resultSelected);

  return (
    <Box flexDirection="column" height={stdout?.rows || 40}>
      <Box justifyContent="space-between" borderStyle="single" borderColor={theme.muted} paddingX={1}>
        <Text bold color={theme.accent}>
          WABA AGENT CONTROL PLANE
        </Text>
        <Text color={cfgStatus.hasToken ? theme.ok : theme.warn}>
          {cfgStatus.hasToken ? "Authenticated" : "Unauthenticated"} | phone={cfgStatus.phone} | business={cfgStatus.business}
        </Text>
      </Box>

      <Box flexDirection="row" flexGrow={1}>
        {showSidebar ? (
          <Box flexDirection="column" width={compact ? 24 : 30} borderStyle="round" borderColor={theme.muted} paddingX={1} marginRight={1}>
            <Text bold color={theme.accent}>
              SECTIONS
            </Text>
            {navLines.map((line, i) => (
              <Text key={`nav-${i}`} color={line.includes("<-") ? theme.accentStrong : theme.text}>
                {line}
              </Text>
            ))}
            <Text color={theme.muted} dimColor>
              Tab/Arrows focus | Enter approve
            </Text>
          </Box>
        ) : null}

        <Box flexDirection="column" flexGrow={1}>
          <Box>
            <Panel title="PLAN" lines={[state.plan ? JSON.stringify(state.plan) : "No plan"]} focused={focusedPanel === "plan"} compact={compact} />
            <Panel title="ACTION_QUEUE" lines={queueRows} focused={focusedPanel === "queue"} compact={compact} />
            <Panel
              title="APPROVALS"
              lines={state.approvals.length ? state.approvals.map((x) => `${x.action} [${x.risk}]`) : ["No approvals pending."]}
              focused={focusedPanel === "approvals"}
              compact={compact}
            />
          </Box>
          <Box>
            <Panel title="LIVE_LOGS" lines={state.liveLogs.length ? state.liveLogs : ["No logs"]} focused={focusedPanel === "logs"} compact={compact} />
            <Panel title="RESULTS" lines={resultRows} focused={focusedPanel === "results"} compact={compact} />
            <Panel
              title="ROLLBACK"
              lines={state.rollback.length ? state.rollback.map((x) => `${x.id.slice(0, 8)} ${x.action}`) : ["No rollback points."]}
              focused={focusedPanel === "rollback"}
              compact={compact}
            />
          </Box>
        </Box>
      </Box>

      {confirmState ? (
        <Modal
          title={`APPROVAL ${confirmState.intent.risk}`}
          lines={buildConfirmLines(confirmState)}
          reason={confirmState.reason}
          onReason={(v) => setConfirmState((prev) => (prev ? { ...prev, reason: v } : prev))}
        />
      ) : null}

      <Box marginTop={0} borderStyle="single" borderColor={theme.muted} paddingX={1}>
        <Text color={busy ? theme.warn : theme.text}>{busy ? "running... " : ""}Prompt: </Text>
        <TextInput value={input} onChange={setInput} onSubmit={onSubmit} />
      </Box>

      {showHelp ? (
        <Box borderStyle="round" borderColor={theme.accentStrong} paddingX={1}>
          <Text color={theme.accent}>Help:</Text>
          <Text color={theme.text}> Enter confirm | a approve | r reject | d details | x replay selected result | Tab/Arrows focus | h/? toggle help</Text>
        </Box>
      ) : null}

      <Box justifyContent="space-between" borderStyle="single" borderColor={theme.muted} paddingX={1}>
        <Text color={theme.muted}>
          approvals={summary.approvals} results={summary.results} logs={summary.logs}
        </Text>
        <Text color={toast ? statusColor(toast) : theme.muted}>{toast || "enter=confirm | a=approve | r=reject | d=details | x=replay result | h=help"}</Text>
      </Box>
    </Box>
  );
}

export function startTui(): void {
  render(<App />);
}
