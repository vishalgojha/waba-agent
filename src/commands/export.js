const fs = require("fs-extra");
const path = require("path");
const dayjs = require("dayjs");
const axios = require("axios");

const { getConfig } = require("../lib/config");
const { getClientConfig } = require("../lib/client-config");
const { readMemory } = require("../lib/memory");
const { readState } = require("../lib/flow-state");
const { logger } = require("../lib/logger");
const { ruleBasedIntent } = require("../lib/message-parser");

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

function redactPhone(s) {
  const t = String(s || "");
  const digits = t.replace(/\D/g, "");
  if (digits.length < 8) return "***";
  return `${digits.slice(0, 2)}***${digits.slice(-4)}`;
}

function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  if (!/[,"\r\n]/.test(s)) return s;
  return `"${s.replace(/"/g, "\"\"")}"`;
}

function toCsv(rows, headers) {
  const cols = headers && headers.length ? headers : Object.keys(rows[0] || {});
  const lines = [];
  lines.push(cols.map(csvCell).join(","));
  for (const r of rows) lines.push(cols.map((k) => csvCell(r[k])).join(","));
  return lines.join("\n") + "\n";
}

function statusFromConvo(convo) {
  if (!convo || typeof convo !== "object") return "pending";
  if (convo.completedAt && convo.handoff) return "handoff";
  if (convo.completedAt) return "qualified";
  if (convo.startedAt) return "in_progress";
  return "pending";
}

function pickName(fields) {
  const n = fields?.name || fields?.full_name || fields?.customerName || null;
  return n ? String(n).trim() : "";
}

function pickLocation(fields) {
  const v = fields?.location || fields?.area || fields?.city || null;
  return v ? String(v).trim() : "";
}

function pickBudget(fields) {
  const v = fields?.budget || fields?.price || null;
  return v ? String(v).trim() : "";
}

function isRecent(tsIso, cutoffMs) {
  const ts = Date.parse(tsIso || "");
  return Number.isFinite(ts) && ts >= cutoffMs;
}

async function buildLeadRows({ client, sinceMs, limit = 5000, redact = true } = {}) {
  const now = Date.now();
  const cutoff = now - sinceMs;

  // Flow state has the richest fields and completion state.
  const state = await readState(client);
  const convoByFrom = new Map(); // phone -> convo
  for (const [k, v] of Object.entries(state || {})) {
    const num = normalizeNumber(k);
    if (!num) continue;
    convoByFrom.set(num, v);
  }

  // Memory-based aggregation for last inbound/outbound and AI intent/fields.
  const events = await readMemory(client, { limit: 50_000 });
  const leads = new Map(); // phone -> agg

  const ensure = (phone) => {
    const p = normalizeNumber(phone);
    if (!p) return null;
    const cur = leads.get(p) || {
      phone: p,
      lastInboundAt: null,
      lastReplyAt: null,
      lastText: "",
      intent: "",
      name: "",
      location: "",
      budget: "",
      status: "pending"
    };
    leads.set(p, cur);
    return cur;
  };

  for (const e of events) {
    if (!isRecent(e.ts, cutoff)) continue;

    if (e.type === "inbound_message" || e.type === "inbound_text") {
      const row = ensure(e.from);
      if (!row) continue;
      if (!row.lastInboundAt || String(e.ts) > String(row.lastInboundAt)) {
        row.lastInboundAt = e.ts;
        row.lastText = String(e.text || "").replace(/\s+/g, " ").trim();
      }
      if (!row.intent && row.lastText) row.intent = ruleBasedIntent(row.lastText).intent;
      continue;
    }

    if (e.type === "outbound_sent" || e.type === "auto_reply_sent") {
      const to = e.to || e.recipient || e.to_number;
      const row = ensure(to);
      if (!row) continue;
      if (!row.lastReplyAt || String(e.ts) > String(row.lastReplyAt)) row.lastReplyAt = e.ts;
      continue;
    }

    if (e.type === "lead_classification") {
      const row = ensure(e.from);
      if (!row) continue;
      const intent = e.result?.intent ? String(e.result.intent).trim().toLowerCase() : "";
      if (intent) row.intent = intent;
      const fields = e.result?.fields || {};
      if (!row.name) row.name = pickName(fields);
      if (!row.location) row.location = pickLocation(fields);
      if (!row.budget) row.budget = pickBudget(fields);
      continue;
    }
  }

  // Merge flow state fields (overwrite AI heuristics).
  for (const [phone, convo] of convoByFrom.entries()) {
    const lastInboundAt = convo?.lastInboundAt || convo?.updatedAt || null;
    if (lastInboundAt && !isRecent(lastInboundAt, cutoff)) continue;
    const row = ensure(phone);
    if (!row) continue;
    row.status = statusFromConvo(convo);
    const data = convo?.data || {};
    const name = pickName(data);
    const location = pickLocation(data);
    const budget = pickBudget(data);
    if (name) row.name = name;
    if (location) row.location = location;
    if (budget) row.budget = budget;
    if (lastInboundAt && (!row.lastInboundAt || String(lastInboundAt) > String(row.lastInboundAt))) row.lastInboundAt = lastInboundAt;
  }

  // Finalize: drop empties / keep most recent.
  let rows = [...leads.values()].filter((r) => r.lastInboundAt);
  rows.sort((a, b) => String(b.lastInboundAt).localeCompare(String(a.lastInboundAt)));
  rows = rows.slice(0, Math.max(1, Math.min(50_000, Number(limit) || 5000)));

  return rows.map((r) => ({
    phone: redact ? redactPhone(r.phone) : r.phone,
    name: r.name || "",
    intent: r.intent || "unknown",
    lastInboundAt: r.lastInboundAt || "",
    location: r.location || "",
    budget: r.budget || "",
    status: r.status || "pending",
    lastReplyAt: r.lastReplyAt || ""
  }));
}

function registerExportCommands(program) {
  const e = program.command("export").description("export data for demos and reporting");

  e.command("leads")
    .description("export unique leads to CSV (from memory + flow state)")
    .option("--client <name>", "client name (default: active client)")
    .option("--since <dur>", "lookback window (default: 7d)", "7d")
    .option("--limit <n>", "max leads", (v) => Number(v), 5000)
    .option("--out <path>", "CSV output path (default: ./leads_<client>_<YYYY-MM-DD>.csv)")
    .option("--to <dest>", "also push to an integration: sheets", null)
    .option("--no-redact", "include full phone numbers (PII)", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      if (json) throw new Error("--json not supported for export (use the CSV output).");

      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const sinceMs = parseDurationMs(opts.since);
      if (!sinceMs) throw new Error("Invalid --since. Example: 24h, 7d, 90m");

      const rows = await buildLeadRows({
        client,
        sinceMs,
        limit: opts.limit,
        redact: opts.redact !== false
      });

      const outPath =
        opts.out ||
        path.resolve(process.cwd(), `leads_${client}_${dayjs().format("YYYY-MM-DD")}.csv`);

      const csv = toCsv(rows, ["phone", "name", "intent", "lastInboundAt", "location", "budget", "status", "lastReplyAt"]);
      await fs.writeFile(outPath, csv, "utf8");

      logger.ok(`Wrote: ${outPath}`);
      logger.info(`Rows: ${rows.length}`);

      const to = opts.to ? String(opts.to).toLowerCase() : null;
      if (to === "sheets") {
        const clientCfg = (await getClientConfig(client)) || {};
        const url = clientCfg.integrations?.googleSheets?.appsScriptUrl;
        if (!url) throw new Error("Google Sheets integration not configured. Run: waba integrate google-sheets --apps-script-url <URL>");

        // Use compatible keys for existing Apps Script; extra columns are ignored by that template.
        const payload = {
          client,
          leads: rows.map((r) => ({
            ts: r.lastInboundAt,
            from: r.phone,
            text: `${r.name || ""} ${r.location || ""} ${r.budget || ""}`.trim(),
            intent: r.intent,
            temperature: null,
            responseMinutes: null,
            status: r.status,
            lastReplyAt: r.lastReplyAt
          }))
        };

        logger.info(`Pushing ${rows.length} row(s) -> sheets`);
        const res = await axios.post(url, payload, { timeout: 60_000 });
        logger.ok(`Sheets push OK (HTTP ${res.status})`);
      } else if (to) {
        throw new Error("Unsupported --to. Use: sheets");
      }
    });
}

module.exports = { registerExportCommands };

