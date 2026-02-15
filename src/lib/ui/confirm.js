const readline = require("readline/promises");

const { formatParsedIntent } = require("./format");
const { logger } = require("../logger");

function normalizeChoice(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v || v === "y" || v === "yes") return "yes";
  if (v === "n" || v === "no" || v === "cancel") return "no";
  if (v === "edit" || v === "e") return "edit";
  return "unknown";
}

function unquote(v) {
  const s = String(v || "").trim();
  if ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function coerceField(key, value) {
  const raw = String(value || "").trim();
  if (!raw || /^null$/i.test(raw)) return null;
  if (key === "params") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    } catch {}
    return raw.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  }
  if (key === "confidence") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return unquote(raw);
}

function parseEditInput(input) {
  const src = String(input || "").trim();
  if (!src) return {};

  if (src.startsWith("{")) {
    const parsed = JSON.parse(src);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON edits must be an object.");
    }
    const out = {};
    for (const [k, v] of Object.entries(parsed)) out[k] = coerceField(k, v);
    return out;
  }

  const allowed = new Set(["action", "client", "phone", "template", "params", "message", "datetime", "confidence"]);
  const out = {};
  const pairs = src.split(",").map((x) => x.trim()).filter(Boolean);
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx <= 0) throw new Error(`Invalid edit token: ${pair}`);
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!allowed.has(key)) throw new Error(`Unsupported field: ${key}`);
    out[key] = coerceField(key, value);
  }
  return out;
}

async function fallbackConfirm(intent) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    let current = { ...intent };
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // eslint-disable-next-line no-console
      console.log(formatParsedIntent(current));
      // eslint-disable-next-line no-console
      console.log("\nWARNING: This will send a WhatsApp action and may incur costs.");
      const answer = await rl.question("Confirm? [Y/n/edit] ");
      const choice = normalizeChoice(answer);
      if (choice === "yes") return { confirmed: true, intent: current };
      if (choice === "no") return { confirmed: false, intent: current };
      if (choice === "edit") {
        const patchInput = await rl.question("Edit (key=value, comma-separated or JSON object): ");
        const patch = parseEditInput(patchInput);
        current = { ...current, ...patch };
        continue;
      }
      // eslint-disable-next-line no-console
      console.log("Please answer with y, n, or edit.");
    }
  } finally {
    rl.close();
  }
}

async function inkConfirm(intent) {
  const ink = await import("ink");
  const React = await import("react");
  const textInputModule = await import("ink-text-input");

  const { render, Box, Text, useApp } = ink;
  const ReactApi = React.default || React;
  const TextInput = textInputModule.default;

  return new Promise((resolve) => {
    const h = ReactApi.createElement;

    function App() {
      const app = useApp();
      const [mode, setMode] = ReactApi.useState("confirm");
      const [input, setInput] = ReactApi.useState("");
      const [error, setError] = ReactApi.useState("");
      const [current, setCurrent] = ReactApi.useState({ ...intent });

      const done = (result) => {
        resolve(result);
        app.exit();
      };

      const onSubmit = (value) => {
        if (mode === "confirm") {
          const choice = normalizeChoice(value);
          if (choice === "yes") return done({ confirmed: true, intent: current });
          if (choice === "no") return done({ confirmed: false, intent: current });
          if (choice === "edit") {
            setMode("edit");
            setInput("");
            setError("");
            return;
          }
          setError("Type y, n, or edit.");
          setInput("");
          return;
        }

        try {
          const patch = parseEditInput(value);
          setCurrent({ ...current, ...patch });
          setMode("confirm");
          setInput("");
          setError("");
        } catch (err) {
          setError(String(err?.message || err));
          setInput("");
        }
      };

      const lines = formatParsedIntent(current).split("\n");
      return h(
        Box,
        { flexDirection: "column" },
        ...lines.map((line, idx) => h(Text, { key: `line-${idx}`, color: "cyan" }, line)),
        h(Text, { color: "yellow" }, "WARNING: This will send a WhatsApp message and may incur costs."),
        mode === "confirm"
          ? h(Text, null, "Confirm? [Y/n/edit]")
          : h(Text, null, "Edit fields (key=value pairs or JSON object):"),
        h(TextInput, { value: input, onChange: setInput, onSubmit }),
        error ? h(Text, { color: "red" }, error) : null
      );
    }

    render(h(App));
  });
}

async function showConfirmation(intent) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return fallbackConfirm(intent);
  }
  try {
    return await inkConfirm(intent);
  } catch (err) {
    logger.warn(`Ink confirmation unavailable, falling back to terminal prompt: ${err?.message || err}`);
    return fallbackConfirm(intent);
  }
}

module.exports = {
  showConfirmation,
  parseEditInput,
  normalizeChoice
};
