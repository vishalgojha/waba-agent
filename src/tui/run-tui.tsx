// file: src/tui/run-tui.tsx
import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import { readConfig } from "../../src-ts/config.js";
import type { Intent } from "./tui-types.js";
import { createInitialState, hatchReducer, makeTurn } from "./tui-session-actions.js";
import { handleSlash } from "./tui-command-handlers.js";
import { executeApproved, handleUserText } from "./tui-event-handlers.js";
import { DetailsOverlay, HelpOverlay, InlineEditorHint, PaletteOverlay } from "./tui-overlays.js";

const theme = {
  text: "#D8DEE9",
  muted: "#4C566A",
  accent: "#81A1C1",
  ok: "#A3BE8C",
  warn: "#EBCB8B",
  danger: "#BF616A",
  critical: "#B48EAD"
};

const palette = ["/help", "/doctor", "/status", "/config", "/logs", "/replay latest", "/ai "];

type EditMode =
  | { kind: "slot"; name: string }
  | { kind: "reason" }
  | null;

function riskColor(risk: Intent["risk"]): string {
  if (risk === "LOW") return theme.ok;
  if (risk === "MEDIUM") return theme.warn;
  if (risk === "HIGH") return theme.danger;
  return theme.critical;
}

function Panel({
  title,
  focused,
  children
}: {
  title: string;
  focused?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Box borderStyle={focused ? "bold" : "round"} borderColor={focused ? theme.accent : theme.muted} paddingX={1} flexDirection="column" marginBottom={1}>
      <Text bold color={focused ? theme.accent : theme.muted}>{title}</Text>
      {children}
    </Box>
  );
}

export function RunTui(): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [state, dispatch] = useReducer(hatchReducer, undefined, createInitialState);
  const [input, setInput] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [header, setHeader] = useState({ ready: false, phone: "(missing)", business: "(missing)" });
  const stateRef = useRef(state);
  stateRef.current = state;

  const context = useMemo(
    () => ({
      dispatch,
      getState: () => stateRef.current,
      streamAssistant: async (text: string): Promise<void> => {
        const base = makeTurn("assistant", "");
        dispatch({ type: "push-turn", value: { ...base, streaming: true } });
        let out = "";
        for (const ch of text) {
          out += ch;
          dispatch({ type: "patch-turn", id: base.id, text: out, streaming: true });
          await new Promise<void>((resolve) => setTimeout(resolve, 8));
        }
        dispatch({ type: "patch-turn", id: base.id, text: out, streaming: false });
      }
    }),
    []
  );

  useEffect(() => {
    void (async () => {
      const cfg = await readConfig();
      const ready = !!(cfg.token && cfg.businessId && cfg.phoneNumberId);
      setHeader({
        ready,
        phone: cfg.phoneNumberId || "(missing)",
        business: cfg.businessId || "(missing)"
      });
      dispatch({ type: "bootstrap", value: { connected: ready } });
      dispatch({ type: "push-turn", value: makeTurn("system", ready ? "Hatch session active." : "Setup missing. Run login/onboard first.") });
    })();
  }, []);

  const beginSlotEdit = (): void => {
    const plan = state.plan;
    if (!plan?.missingSlots.length) return;
    const name = plan.missingSlots[0];
    setEditMode({ kind: "slot", name });
    setInput("");
  };

  const applySlotEdit = async (value: string): Promise<void> => {
    if (!editMode || editMode.kind !== "slot" || !state.plan) return;
    const nextIntent: Intent = {
      ...state.plan.intent,
      payload: {
        ...state.plan.intent.payload,
        [editMode.name]: value
      }
    };
    const missing = state.plan.missingSlots.filter((x) => x !== editMode.name || !value.trim());
    dispatch({
      type: "set-plan",
      value: {
        ...state.plan,
        intent: nextIntent,
        missingSlots: missing
      }
    });
    dispatch({ type: "set-queue", value: [nextIntent] });
    dispatch({ type: "push-turn", value: makeTurn("system", `Updated slot ${editMode.name}.`) });
    setEditMode(null);
    if (missing.length === 0) {
      await context.streamAssistant("All required slots are set. Approve to execute.");
    }
  };

  const approveCurrent = async (): Promise<void> => {
    const item = state.approvals[state.selectedApproval] || state.approvals[0];
    if (!item) return;
    if (item.reasonRequired && state.pendingConfirmReason.trim().length < 6) {
      setEditMode({ kind: "reason" });
      setInput(state.pendingConfirmReason);
      await context.streamAssistant("Elevated approval requires reason (min 6 chars). Press Enter after typing reason.");
      return;
    }
    await executeApproved(item.intent, context);
    dispatch({ type: "dequeue-approval", value: item });
    dispatch({ type: "set-queue", value: [] });
    dispatch({ type: "set-plan", value: null });
  };

  const rejectCurrent = async (): Promise<void> => {
    const item = state.approvals[state.selectedApproval] || state.approvals[0];
    if (!item) return;
    dispatch({ type: "dequeue-approval", value: item });
    dispatch({ type: "set-queue", value: [] });
    dispatch({ type: "set-plan", value: null });
    await context.streamAssistant(`Rejected ${item.intent.action}.`);
  };

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") {
      exit();
      return;
    }
    if (ch === "q") {
      exit();
      return;
    }

    if (state.showPalette) {
      if (key.upArrow) {
        setPaletteIndex((v) => (v - 1 + palette.length) % palette.length);
        return;
      }
      if (key.downArrow) {
        setPaletteIndex((v) => (v + 1) % palette.length);
        return;
      }
      if (key.return) {
        const command = palette[paletteIndex] || "/help";
        setInput(command);
        dispatch({ type: "toggle-palette" });
        return;
      }
    }

    if (key.upArrow && !state.showPalette && !editMode) {
      dispatch({ type: "history-prev" });
      setInput(stateRef.current.inputHistory[Math.max(0, stateRef.current.historyIndex + 1)] || stateRef.current.input || "");
      return;
    }
    if (key.downArrow && !state.showPalette && !editMode) {
      dispatch({ type: "history-next" });
      const nextIndex = stateRef.current.historyIndex - 1;
      setInput(nextIndex >= 0 ? stateRef.current.inputHistory[nextIndex] || "" : "");
      return;
    }

    if (ch === "?" ) {
      dispatch({ type: "toggle-help" });
      return;
    }
    if (ch === "x") {
      dispatch({ type: "toggle-rail" });
      return;
    }
    if (ch === "/" && input.trim().length === 0) {
      dispatch({ type: "toggle-palette" });
      return;
    }
    if (ch === "d") {
      setDetailsOpen((v) => !v);
      return;
    }
    if (ch === "e") {
      if ((state.plan?.missingSlots.length || 0) > 0) {
        beginSlotEdit();
        return;
      }
      const item = state.approvals[state.selectedApproval] || state.approvals[0];
      if (item?.reasonRequired) {
        setEditMode({ kind: "reason" });
        setInput(state.pendingConfirmReason);
      }
      return;
    }
    if (ch === "a") {
      void approveCurrent();
      return;
    }
    if (ch === "r") {
      void rejectCurrent();
      return;
    }
    if (key.return && !editMode && state.approvals.length > 0 && input.trim().length === 0) {
      void approveCurrent();
      return;
    }
  });

  const submitInput = async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!text) return;
    setInput("");
    dispatch({ type: "push-history", value: text });

    if (editMode?.kind === "slot") {
      await applySlotEdit(text);
      return;
    }
    if (editMode?.kind === "reason") {
      dispatch({ type: "set-confirm-reason", value: text });
      setEditMode(null);
      await context.streamAssistant("Approval reason updated. Press a/Enter to proceed.");
      return;
    }

    const slash = await handleSlash(text, context);
    if (slash.handled && !slash.message) return;
    const actual = slash.message || text;
    await handleUserText(actual, context);
  };

  const transcript = [...state.transcript].reverse().slice(-18);
  const showRail = state.railOpen && (stdout?.columns || 120) >= 106;
  const selectedApproval = state.approvals[state.selectedApproval] || state.approvals[0];
  const selectedResult = state.results[state.selectedResult];

  return (
    <Box flexDirection="column" height={stdout?.rows || 40}>
      <Box justifyContent="space-between" borderStyle="single" borderColor={theme.muted} paddingX={1}>
        <Text bold color={theme.accent}>HATCH</Text>
        <Text color={header.ready ? theme.ok : theme.warn}>
          {header.ready ? "connected" : "setup required"} | phone={header.phone} | business={header.business}
        </Text>
      </Box>

      <Box flexGrow={1} flexDirection="row">
        <Panel title="CHAT" focused>
          {transcript.length ? transcript.map((turn) => (
            <Box key={turn.id} flexDirection="column" marginBottom={1}>
              <Text color={theme.muted}>[{turn.ts}] {turn.role}</Text>
              <Text color={turn.role === "assistant" ? theme.accent : turn.role === "system" ? theme.warn : theme.text}>
                {turn.text}{turn.streaming ? "_" : ""}
              </Text>
            </Box>
          )) : <Text color={theme.muted}>No transcript yet.</Text>}
        </Panel>

        {showRail ? (
          <Box width={44} flexDirection="column" marginLeft={1}>
            <Panel title="PLAN">
              {state.plan ? (
                <>
                  <Text color={theme.text}>action={state.plan.action}</Text>
                  <Text color={riskColor(state.plan.risk)}>risk={state.plan.risk}</Text>
                  <Text color={theme.text}>missing={state.plan.missingSlots.length ? state.plan.missingSlots.join(",") : "none"}</Text>
                </>
              ) : <Text color={theme.muted}>No active plan.</Text>}
            </Panel>
            <Panel title="ACTIONS_QUEUE">
              {state.queue.length ? state.queue.map((item, i) => (
                <Text key={`${item.action}-${i}`} color={theme.text}>{i + 1}. {item.action}</Text>
              )) : <Text color={theme.muted}>Queue empty.</Text>}
            </Panel>
            <Panel title="APPROVALS">
              {state.approvals.length ? state.approvals.map((item, i) => (
                <Text key={item.id} color={i === state.selectedApproval ? theme.warn : theme.text}>
                  {i === state.selectedApproval ? "> " : "  "}{item.intent.action} ({item.intent.risk})
                </Text>
              )) : <Text color={theme.muted}>None pending.</Text>}
            </Panel>
            <Panel title="RESULTS">
              {selectedResult ? (
                <>
                  <Text color={theme.ok}>action={selectedResult.action}</Text>
                  <Text color={theme.text}>id={selectedResult.id}</Text>
                </>
              ) : <Text color={theme.muted}>No results.</Text>}
            </Panel>
            <Panel title="ROLLBACK">
              {state.rollback.length ? state.rollback.slice(0, 1).map((item) => (
                <Text key={item.id} color={theme.text}>{item.replayHint}</Text>
              )) : <Text color={theme.muted}>No rollback notes.</Text>}
            </Panel>
          </Box>
        ) : null}
      </Box>

      {detailsOpen ? <DetailsOverlay state={state} /> : null}
      {state.showHelp ? <HelpOverlay /> : null}
      {state.showPalette ? <PaletteOverlay commands={palette} selected={paletteIndex} /> : null}
      {editMode ? <InlineEditorHint mode={editMode.kind} slotName={editMode.kind === "slot" ? editMode.name : undefined} /> : null}

      {selectedApproval?.reasonRequired ? (
        <Box borderStyle="single" borderColor={theme.critical} paddingX={1}>
          <Text color={theme.critical}>approval reason: {state.pendingConfirmReason || "(required)"}</Text>
        </Box>
      ) : null}

      <Box borderStyle="single" borderColor={theme.muted} paddingX={1}>
        <Text color={theme.text}>{editMode?.kind === "reason" ? "reason> " : editMode?.kind === "slot" ? `${editMode.name}> ` : "> "}</Text>
        <TextInput value={input} onChange={setInput} onSubmit={(v) => void submitInput(v)} />
      </Box>

      <Box borderStyle="single" borderColor={theme.muted} paddingX={1} justifyContent="space-between">
        <Text color={theme.muted}>Enter send | a approve | r reject | e edit | / palette | x rail | q quit</Text>
        <Text color={theme.muted}>logs={state.logs.length}</Text>
      </Box>
    </Box>
  );
}