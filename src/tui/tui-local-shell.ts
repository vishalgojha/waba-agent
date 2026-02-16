// file: src/tui/tui-local-shell.ts
export interface LocalShellResult {
  ok: boolean;
  detail: string;
}

export async function runLocalShellCommand(_command: string): Promise<LocalShellResult> {
  return {
    ok: false,
    detail: "Local shell execution is disabled in Hatch runtime by policy."
  };
}