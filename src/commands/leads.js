const dayjs = require("dayjs");

const { getConfig } = require("../lib/config");
const { readMemory } = require("../lib/memory");
const { logger } = require("../lib/logger");

function redactPhone(s) {
  const t = String(s || "");
  const digits = t.replace(/\D/g, "");
  if (digits.length < 8) return "***";
  return `${digits.slice(0, 2)}***${digits.slice(-4)}`;
}

function parseDurationMs(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2] || "ms";
  if (!Number.isFinite(n) || n < 0) return null;
  if (u === "ms") return Math.floor(n);
  if (u === "s") return Math.floor(n * 1000);
  if (u === "m") return Math.floor(n * 60_000);
  if (u === "h") return Math.floor(n * 3_600_000);
  if (u === "d") return Math.floor(n * 86_400_000);
  return null;
}

function normalizeNumber(x) {
  const t = String(x || "").trim().replace(/^\+/, "");
  return t.replace(/[^0-9]/g, "");
}

function isInbound(e) {
  const t = String(e?.type || "");
  return t === "inbound_message" || t === "inbound_text" || t.startsWith("inbound_");
}

function isOutbound(e) {
  const t = String(e?.type || "");
  return t === "outbound_sent" || t === "auto_reply_sent" || t.startsWith("outbound_");
}

function isRecent(e, cutoffMs) {
  const ts = Date.parse(e?.ts || "");
  return Number.isFinite(ts) && ts >= cutoffMs;
}

function fmtAgeMinutes(tsIso) {
  const t = dayjs(tsIso);
  if (!t.isValid()) return null;
  const mins = dayjs().diff(t, "minute", true);
  return Math.max(0, Math.round(mins));
}

function lastTextSnippet(e) {
  const s = String(e?.text || e?.body || "");
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > 140 ? `${t.slice(0, 140)}...` : t;
}

function registerLeadsCommands(program) {
  const l = program.command("leads").description("lead ops helpers (missed leads, follow-ups)");

  l.command("missed")
    .description("list inbound leads that have no outbound response after the last inbound message")
    .option("--client <name>", "client name (default: active client)")
    .option("--since <dur>", "lookback window (default: 24h)", "24h")
    .option("--min-age <dur>", "ignore very recent inbound (default: 5m)", "5m")
    .option("--limit <n>", "max leads", (v) => Number(v), 50)
    .option("--no-redact", "do not redact phone numbers (not recommended)", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      const sinceMs = parseDurationMs(opts.since);
      const minAgeMs = parseDurationMs(opts.minAge);
      if (!sinceMs) throw new Error("Invalid --since. Example: 24h, 2d, 90m");
      if (!minAgeMs) throw new Error("Invalid --min-age. Example: 5m, 30s");

      const now = Date.now();
      const cutoff = now - sinceMs;
      const minInboundTs = now - minAgeMs;

      const events = await readMemory(client, { limit: 50_000 });
      const recent = events.filter((e) => isRecent(e, cutoff));

      // Aggregate per number.
      const by = new Map(); // from -> { lastInboundAt, lastOutboundAt, lastInboundEvent }
      for (const e of recent) {
        if (isInbound(e)) {
          const from = normalizeNumber(e.from);
          if (!from) continue;
          const ts = Date.parse(e.ts || "");
          if (!Number.isFinite(ts)) continue;
          const prev = by.get(from) || { from, lastInboundAt: null, lastOutboundAt: null, lastInboundEvent: null };
          if (!prev.lastInboundAt || ts > Date.parse(prev.lastInboundAt)) {
            prev.lastInboundAt = new Date(ts).toISOString();
            prev.lastInboundEvent = e;
          }
          by.set(from, prev);
        } else if (isOutbound(e)) {
          const to = normalizeNumber(e.to || e.recipient || e.to_number);
          if (!to) continue;
          const ts = Date.parse(e.ts || "");
          if (!Number.isFinite(ts)) continue;
          const prev = by.get(to) || { from: to, lastInboundAt: null, lastOutboundAt: null, lastInboundEvent: null };
          if (!prev.lastOutboundAt || ts > Date.parse(prev.lastOutboundAt)) {
            prev.lastOutboundAt = new Date(ts).toISOString();
          }
          by.set(to, prev);
        }
      }

      let missed = [];
      for (const x of by.values()) {
        if (!x.lastInboundAt) continue;
        const inboundTs = Date.parse(x.lastInboundAt);
        if (!Number.isFinite(inboundTs) || inboundTs > now) continue;
        if (inboundTs > minInboundTs) continue; // too fresh
        const outboundTs = x.lastOutboundAt ? Date.parse(x.lastOutboundAt) : NaN;
        const okOutbound = Number.isFinite(outboundTs) && outboundTs >= inboundTs;
        if (okOutbound) continue;
        missed.push(x);
      }

      missed.sort((a, b) => Date.parse(b.lastInboundAt) - Date.parse(a.lastInboundAt));
      missed = missed.slice(0, Math.max(1, Math.min(500, Number(opts.limit) || 50)));

      const out = missed.map((x) => {
        const fromRaw = x.from;
        return {
          from: opts.redact === false ? fromRaw : redactPhone(fromRaw),
          lastInboundAt: x.lastInboundAt,
          ageMinutes: fmtAgeMinutes(x.lastInboundAt),
          lastInboundType: x.lastInboundEvent?.msgType || x.lastInboundEvent?.type || null,
          lastText: lastTextSnippet(x.lastInboundEvent)
        };
      });

      const result = {
        client,
        window: { since: opts.since, minAge: opts.minAge },
        count: out.length,
        leads: out
      };

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, result }, null, 2));
        return;
      }

      logger.info(`Missed leads (${client}): ${out.length}`);
      for (const r of out) {
        logger.info(`${r.from} age=${r.ageMinutes}m inbound=${r.lastInboundAt} text="${r.lastText}"`);
      }
      logger.info("Tip: use templates/campaigns for follow-ups outside the 24h window.");
    });
}

module.exports = { registerLeadsCommands };

