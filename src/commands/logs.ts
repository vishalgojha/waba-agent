// @ts-nocheck
const fs = require("fs-extra");

const { getConfig } = require("../lib/config");
const { memoryPath } = require("../lib/memory");
const { logger } = require("../lib/logger");

function redactPhone(s) {
  const t = String(s || "");
  if (!t) return t;
  const digits = t.replace(/\D/g, "");
  if (digits.length < 8) return "***";
  return `${digits.slice(0, 2)}***${digits.slice(-4)}`;
}

function redactEvent(e) {
  if (!e || typeof e !== "object") return e;
  const out = { ...e };
  if (out.from) out.from = redactPhone(out.from);
  if (out.to) out.to = redactPhone(out.to);
  if (out.phone) out.phone = redactPhone(out.phone);
  if (out.recipient) out.recipient = redactPhone(out.recipient);
  if (out.recipient_id) out.recipient_id = redactPhone(out.recipient_id);
  return out;
}

function fmtLine(e) {
  const ts = e.ts || e.timestamp || "";
  const type = e.type || e.event || "event";
  const from = e.from ? ` from=${redactPhone(e.from)}` : "";
  const to = e.to ? ` to=${redactPhone(e.to)}` : "";
  const intent = e.intent ? ` intent=${e.intent}` : "";
  return `${ts} ${type}${from}${to}${intent}`.trim();
}

async function readLastLines(filePath, n) {
  if (!(await fs.pathExists(filePath))) return [];
  const stat = await fs.stat(filePath);
  const size = stat.size;
  if (!size) return [];

  const fd = await fs.open(filePath, "r");
  try {
    const chunkSize = 64 * 1024;
    let pos = size;
    let buf = "";
    while (pos > 0 && buf.split("\n").filter(Boolean).length < n + 5) {
      const readSize = Math.min(chunkSize, pos);
      pos -= readSize;
      const b = Buffer.allocUnsafe(readSize);
      // eslint-disable-next-line no-await-in-loop
      await fs.read(fd, b, 0, readSize, pos);
      buf = b.toString("utf8") + buf;
      // Avoid unbounded memory if file is huge.
      if (buf.length > 2 * 1024 * 1024) buf = buf.slice(-2 * 1024 * 1024);
    }
    const lines = buf.split("\n").filter(Boolean);
    return lines.slice(Math.max(0, lines.length - n));
  } finally {
    await fs.close(fd);
  }
}

function parseJsonLines(lines) {
  const out = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l));
    } catch {}
  }
  return out;
}

async function followFile(filePath, { onLines }) {
  let pos = 0;
  try {
    const stat = await fs.stat(filePath);
    pos = stat.size;
  } catch {
    pos = 0;
  }

  let timer = null;
  const onChange = async () => {
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      try {
        const stat = await fs.stat(filePath);
        if (stat.size < pos) {
          // rotated/truncated
          pos = 0;
        }
        if (stat.size === pos) return;
        const fd = await fs.open(filePath, "r");
        try {
          const len = stat.size - pos;
          const b = Buffer.allocUnsafe(len);
          await fs.read(fd, b, 0, len, pos);
          pos = stat.size;
          const text = b.toString("utf8");
          const lines = text.split("\n").filter(Boolean);
          if (lines.length) await onLines(lines);
        } finally {
          await fs.close(fd);
        }
      } catch (err) {
        logger.warn(`follow error: ${err?.message || err}`);
      }
    }, 150);
  };

  const watcher = fs.watch(filePath, { persistent: true }, () => onChange());
  return () => watcher.close();
}

function registerLogsCommands(program) {
  const l = program.command("logs").description("debugging helpers (tail memory logs)");

  l.command("tail")
    .description("tail a client's memory.jsonl (redacts phone numbers by default)")
    .option("--client <name>", "client name (default: active client)")
    .option("--lines <n>", "lines", (v) => Number(v), 200)
    .option("--type <type>", "filter by event.type (exact match)")
    .option("--jsonl", "print raw redacted JSON per line", false)
    .option("--no-redact", "do not redact PII (not recommended)", false)
    .option("--follow", "follow (like tail -f)", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      if (json) throw new Error("--json not supported for streaming logs.");

      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const p = memoryPath(client);
      const n = Math.max(1, Math.min(5000, Number(opts.lines) || 200));
      const filterType = opts.type ? String(opts.type) : null;

      const printEvents = (events) => {
        for (const e0 of events) {
          const e = opts.redact === false ? e0 : redactEvent(e0);
          if (filterType && String(e.type || "") !== filterType) continue;
          if (opts.jsonl) {
            // eslint-disable-next-line no-console
            console.log(JSON.stringify(e));
          } else {
            logger.info(fmtLine(e));
          }
        }
      };

      const lines = await readLastLines(p, n);
      const events = parseJsonLines(lines);
      if (!(await fs.pathExists(p))) {
        logger.warn(`No memory log found yet for '${client}'. Expected: ${p}`);
      }
      printEvents(events);

      if (!opts.follow) return;
      logger.ok(`Following: ${p}`);

      const stop = await followFile(p, {
        onLines: async (newLines) => {
          const newEvents = parseJsonLines(newLines);
          printEvents(newEvents);
        }
      });

      // Keep alive until Ctrl+C.
      const onSig = () => {
        try {
          stop();
        } catch {}
        process.exit(0);
      };
      process.on("SIGINT", onSig);
      process.on("SIGTERM", onSig);
    });
}

module.exports = { registerLogsCommands };

