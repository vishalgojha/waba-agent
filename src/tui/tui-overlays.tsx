// file: src/tui/tui-overlays.ts
import React from "react";
import { Box, Text } from "ink";
import type { HatchState } from "./tui-types.js";

const theme = {
  text: "#D8DEE9",
  muted: "#4C566A",
  accent: "#81A1C1",
  warn: "#EBCB8B",
  danger: "#BF616A"
};

export function HelpOverlay(): React.JSX.Element {
  const lines = [
    "Enter send/confirm",
    "a approve", 
    "r reject",
    "e edit missing slots / approval reason",
    "d details",
    "/ toggle command palette",
    "x collapse/expand right rail",
    "? help",
    "q or Ctrl+C quit",
    "Up/Down input history"
  ];
  return (
    <Box borderStyle="double" borderColor={theme.accent} paddingX={1} flexDirection="column" marginTop={1}>
      <Text bold color={theme.accent}>HELP</Text>
      {lines.map((line) => (
        <Text key={line} color={theme.text}>{line}</Text>
      ))}
    </Box>
  );
}

export function PaletteOverlay({
  commands,
  selected
}: {
  commands: string[];
  selected: number;
}): React.JSX.Element {
  return (
    <Box borderStyle="double" borderColor={theme.accent} paddingX={1} flexDirection="column" marginTop={1}>
      <Text bold color={theme.accent}>COMMAND PALETTE</Text>
      {commands.map((cmd, idx) => (
        <Text key={cmd} color={idx === selected ? theme.warn : theme.text}>
          {idx === selected ? "> " : "  "}{cmd}
        </Text>
      ))}
    </Box>
  );
}

export function DetailsOverlay({ state }: { state: HatchState }): React.JSX.Element {
  const selectedResult = state.results[state.selectedResult];
  const selectedApproval = state.approvals[state.selectedApproval] || state.approvals[0];
  return (
    <Box borderStyle="round" borderColor={theme.muted} paddingX={1} flexDirection="column" marginTop={1}>
      <Text bold color={theme.accent}>DETAILS</Text>
      <Text color={theme.text}>session={state.sessionId}</Text>
      <Text color={theme.text}>queue={state.queue.length} approvals={state.approvals.length} results={state.results.length}</Text>
      <Text color={theme.text}>selectedApproval={selectedApproval?.intent.action || "none"}</Text>
      <Text color={theme.text}>selectedResult={selectedResult?.action || "none"}</Text>
      <Text color={theme.text}>rollback={state.rollback.length} approvalHistory={state.approvalHistory.length}</Text>
      <Text color={theme.danger}>No shell execution path enabled in Hatch.</Text>
    </Box>
  );
}

export function InlineEditorHint({
  mode,
  slotName
}: {
  mode: "slot" | "reason";
  slotName?: string;
}): React.JSX.Element {
  const label = mode === "slot" ? `Editing slot: ${slotName || "payload"}` : "Approval reason";
  const hint = mode === "slot" ? "Type value and press Enter." : "Type reason (min 6 chars), then press Enter.";
  return (
    <Box borderStyle="single" borderColor={theme.warn} paddingX={1}>
      <Text color={theme.warn}>{label} | {hint}</Text>
    </Box>
  );
}