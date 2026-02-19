// file: src/tui/tui-persist.ts
import fs from "fs-extra";
import os from "os";
import path from "path";
import type { DomainFlowSummary } from "./tui-types.js";

interface HatchPersistedState {
  domainFlow: DomainFlowSummary | null;
}

function hatchHome(): string {
  return process.env.WABA_HOME || process.env.WABA_AGENT_HOME || path.join(os.homedir(), ".waba");
}

function hatchStatePath(): string {
  return path.join(hatchHome(), "hatch-session.json");
}

export async function loadHatchState(): Promise<HatchPersistedState> {
  const p = hatchStatePath();
  if (!(await fs.pathExists(p))) return { domainFlow: null };
  try {
    const raw = await fs.readJson(p);
    const df = raw?.domainFlow;
    if (!df || typeof df !== "object") return { domainFlow: null };
    return {
      domainFlow: {
        name: String(df.name || ""),
        stage: String(df.stage || ""),
        risk: String(df.risk || "MEDIUM").toUpperCase() as DomainFlowSummary["risk"],
        target: String(df.target || ""),
        recommendationCodes: Array.isArray(df.recommendationCodes) ? df.recommendationCodes.map((x: unknown) => String(x)) : [],
        preview: String(df.preview || ""),
        updatedAt: String(df.updatedAt || "")
      }
    };
  } catch {
    return { domainFlow: null };
  }
}

export async function saveHatchState(state: HatchPersistedState): Promise<void> {
  const p = hatchStatePath();
  await fs.ensureDir(path.dirname(p));
  await fs.writeJson(
    p,
    {
      domainFlow: state.domainFlow || null,
      updatedAt: new Date().toISOString()
    },
    { spaces: 2 }
  );
}
