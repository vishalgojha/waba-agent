// file: src/tui/index.tsx
import React from "react";
import { render } from "ink";
import { RunTui } from "./run-tui.js";

export function startHatchTui(): void {
  render(<RunTui />);
}

export const startTui = startHatchTui;