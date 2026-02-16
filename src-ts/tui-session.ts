// src-ts/tui-session.ts
import fs from "fs-extra";
import path from "path";
import { wabaAgentHome } from "./config.js";
import type { PanelKey } from "./tui-view-model.js";

export interface TuiPersistedState {
  focusedPanel: PanelKey;
  lastPrompt: string;
}

function tuiSessionPath(): string {
  return path.join(wabaAgentHome(), "tui-session.json");
}

export async function loadTuiSession(): Promise<TuiPersistedState | null> {
  const p = tuiSessionPath();
  if (!(await fs.pathExists(p))) return null;
  const raw = await fs.readJson(p);
  const focusedPanel = String(raw?.focusedPanel || "plan") as PanelKey;
  const lastPrompt = String(raw?.lastPrompt || "");
  return { focusedPanel, lastPrompt };
}

export async function saveTuiSession(state: TuiPersistedState): Promise<void> {
  const p = tuiSessionPath();
  await fs.ensureDir(path.dirname(p));
  await fs.writeJson(
    p,
    {
      focusedPanel: state.focusedPanel,
      lastPrompt: state.lastPrompt,
      updatedAt: new Date().toISOString()
    },
    { spaces: 2 }
  );
}

