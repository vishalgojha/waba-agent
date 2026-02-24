// @ts-nocheck
const { spawn } = require("child_process");

const DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434/v1";

function shouldAutoStartOllama(cfg = {}) {
  const flag = String(process.env.WABA_OLLAMA_AUTOSTART || "1").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(flag)) return false;

  const provider = String(cfg.aiProvider || "").trim().toLowerCase();
  if (provider === "ollama") return true;

  const baseUrl = String(cfg.openaiBaseUrl || "").trim().toLowerCase();
  return baseUrl.includes("127.0.0.1:11434") || baseUrl.includes("localhost:11434");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isOllamaReachable(baseUrl = DEFAULT_OLLAMA_BASE) {
  const root = String(baseUrl || DEFAULT_OLLAMA_BASE).replace(/\/+$/, "");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1200);
  try {
    const res = await fetch(`${root.replace(/\/v1$/, "")}/api/tags`, {
      method: "GET",
      signal: ctrl.signal
    });
    return !!res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function startOllamaProcess() {
  if (process.platform === "win32") {
    const child = spawn("cmd.exe", ["/c", "start", "\"\"", "/min", "ollama", "serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    return;
  }

  const child = spawn("ollama", ["serve"], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

async function ensureOllamaRunning({ cfg = {}, logger = null } = {}) {
  if (!shouldAutoStartOllama(cfg)) return { attempted: false, running: false };

  const base = cfg.openaiBaseUrl || DEFAULT_OLLAMA_BASE;
  if (await isOllamaReachable(base)) {
    return { attempted: false, running: true };
  }

  try {
    if (logger?.info) logger.info("Ollama not detected. Starting local Ollama service...");
    startOllamaProcess();
  } catch (err) {
    if (logger?.warn) logger.warn(`Could not auto-start Ollama: ${err?.message || err}`);
    return { attempted: true, running: false, error: String(err?.message || err) };
  }

  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(800);
    // eslint-disable-next-line no-await-in-loop
    if (await isOllamaReachable(base)) {
      if (logger?.ok) logger.ok("Ollama is running.");
      return { attempted: true, running: true };
    }
  }

  if (logger?.warn) logger.warn("Ollama still not reachable. You can run: ollama serve");
  return { attempted: true, running: false };
}

module.exports = {
  shouldAutoStartOllama,
  isOllamaReachable,
  ensureOllamaRunning
};

