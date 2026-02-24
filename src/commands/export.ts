// @ts-nocheck
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
const { computeMetrics } = require("../lib/analytics");

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

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fmtNum(n, digits = 1) {
  if (n === null || n === undefined) return "-";
  const x = Number(n);
  if (!Number.isFinite(x)) return "-";
  return x.toFixed(digits);
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

function computeFlowStatusCounts(state, { cutoffMs } = {}) {
  const counts = { pending: 0, in_progress: 0, qualified: 0, handoff: 0 };
  for (const [k, convo] of Object.entries(state || {})) {
    const last = convo?.lastInboundAt || convo?.updatedAt || convo?.startedAt || null;
    if (cutoffMs != null) {
      const ts = Date.parse(last || "");
      if (!Number.isFinite(ts) || ts < cutoffMs) continue;
    }
    const st = statusFromConvo(convo);
    counts[st] = (counts[st] || 0) + 1;
  }
  return counts;
}

function lastTextSnippet(e) {
  const s = String(e?.text || e?.body || "");
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > 120 ? `${t.slice(0, 120)}...` : t;
}

function computeMissedLeadsFromEvents(events, { cutoffMs, minAgeMs = 10 * 60 * 1000 } = {}) {
  const now = Date.now();
  const minInboundTs = now - minAgeMs;
  const by = new Map(); // phone -> { phone, lastInboundAt, lastOutboundAt, lastInboundText }

  const ensure = (phone) => {
    const p = normalizeNumber(phone);
    if (!p) return null;
    const cur = by.get(p) || { phone: p, lastInboundAt: null, lastOutboundAt: null, lastInboundText: "" };
    by.set(p, cur);
    return cur;
  };

  for (const e of events || []) {
    const ts = Date.parse(e?.ts || "");
    if (!Number.isFinite(ts)) continue;
    if (cutoffMs != null && ts < cutoffMs) continue;

    if (e.type === "inbound_message" || e.type === "inbound_text" || String(e.type || "").startsWith("inbound_")) {
      const row = ensure(e.from);
      if (!row) continue;
      if (!row.lastInboundAt || ts > Date.parse(row.lastInboundAt)) {
        row.lastInboundAt = new Date(ts).toISOString();
        row.lastInboundText = lastTextSnippet(e);
      }
      continue;
    }

    if (e.type === "outbound_sent" || e.type === "auto_reply_sent" || String(e.type || "").startsWith("outbound_")) {
      const to = e.to || e.recipient || e.to_number;
      const row = ensure(to);
      if (!row) continue;
      if (!row.lastOutboundAt || ts > Date.parse(row.lastOutboundAt)) {
        row.lastOutboundAt = new Date(ts).toISOString();
      }
      continue;
    }
  }

  const missed = [];
  for (const x of by.values()) {
    if (!x.lastInboundAt) continue;
    const inboundTs = Date.parse(x.lastInboundAt);
    if (!Number.isFinite(inboundTs) || inboundTs > now) continue;
    if (inboundTs > minInboundTs) continue;
    const outboundTs = x.lastOutboundAt ? Date.parse(x.lastOutboundAt) : NaN;
    const hasReply = Number.isFinite(outboundTs) && outboundTs >= inboundTs;
    if (hasReply) continue;
    missed.push(x);
  }

  missed.sort((a, b) => Date.parse(b.lastInboundAt) - Date.parse(a.lastInboundAt));
  return {
    count: missed.length,
    sample: missed.slice(0, 10).map((x) => ({
      phone: redactPhone(x.phone),
      lastInboundAt: x.lastInboundAt,
      lastText: x.lastInboundText
    }))
  };
}

function summaryHtml({ title, subtitle, summary }) {
  const m = summary.metrics;
  const missed = summary.missedLeads;
  const flow = summary.flowStatuses;
  const cost = m?.costs?.inr?.totalKnown ?? 0;
  const intents = Object.entries(m?.funnel?.intents || {}).sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, 10);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 24px; color: #111; }
      .muted { color: #555; }
      .grid { display: flex; gap: 12px; flex-wrap: wrap; }
      .card { border: 1px solid #e6e6e6; border-radius: 12px; padding: 12px 14px; min-width: 260px; background: #fff; }
      h1 { margin: 0 0 6px 0; font-size: 20px; }
      h2 { margin: 0 0 10px 0; font-size: 14px; color: #333; }
      h3 { margin: 18px 0 10px; font-size: 14px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #eee; padding: 8px; font-size: 12px; vertical-align: top; }
      th { background: #fafafa; text-align: left; }
      .pill { display:inline-block; padding: 2px 8px; border-radius: 999px; border:1px solid #ddd; font-size:12px; margin-right:6px; margin-bottom:6px; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <div class="muted">${escapeHtml(subtitle)}</div>
    <div style="height:12px"></div>

    <div class="grid">
      <div class="card">
        <h2>Lead Volume</h2>
        <div><b>${m?.leads?.uniqueSenders ?? "-"}</b> unique senders</div>
        <div><b>${m?.leads?.inboundMessages ?? "-"}</b> inbound messages</div>
      </div>
      <div class="card">
        <h2>Missed Leads</h2>
        <div><b>${missed?.count ?? "-"}</b> missed leads</div>
        <div class="muted">inbound with no reply after last inbound</div>
      </div>
      <div class="card">
        <h2>Response Times</h2>
        <div>avg: <b>${fmtNum(m?.responses?.avgMinutes)}</b> min</div>
        <div>p50: <b>${fmtNum(m?.responses?.p50Minutes)}</b> min</div>
        <div>p90: <b>${fmtNum(m?.responses?.p90Minutes)}</b> min</div>
        <div class="muted">samples: ${m?.responses?.samples ?? "-"}</div>
      </div>
      <div class="card">
        <h2>Costs (Estimate)</h2>
        <div>known total: <b>INR ${fmtNum(cost, 2)}</b></div>
        <div class="muted">utility: ${m?.costs?.messages?.utility ?? "-"}, marketing: ${m?.costs?.messages?.marketing ?? "-"}, unknown: ${m?.costs?.messages?.unknown ?? "-"}</div>
      </div>
      <div class="card">
        <h2>Flow Status</h2>
        <div>qualified: <b>${flow?.qualified ?? 0}</b></div>
        <div>handoff: <b>${flow?.handoff ?? 0}</b></div>
        <div>in_progress: <b>${flow?.in_progress ?? 0}</b></div>
        <div>pending: <b>${flow?.pending ?? 0}</b></div>
      </div>
    </div>

    <h3>Top Intents</h3>
    <div>
      ${intents.length ? intents.map(([k, v]) => `<span class="pill">${escapeHtml(k)}: <b>${v}</b></span>`).join(" ") : "<span class='muted'>No intent data yet.</span>"}
    </div>

    <h3>Missed Lead Samples (Redacted)</h3>
    <table>
      <thead><tr><th>When</th><th>From</th><th>Text</th></tr></thead>
      <tbody>
        ${(missed?.sample || []).map((x) => `<tr><td>${escapeHtml(x.lastInboundAt)}</td><td>${escapeHtml(x.phone)}</td><td>${escapeHtml(x.lastText)}</td></tr>`).join("\n")}
      </tbody>
    </table>

    <h3>Next Actions</h3>
    <ul>
      <li>If missed leads &gt; 0: run <code>waba leads followup --mode schedule</code> with an approved follow-up template.</li>
      <li>If p90 response is high: enable staff notifications + reduce manual delays.</li>
      <li>For follow-ups outside 24h: use templates only (compliance).</li>
    </ul>

    <div class="muted">Generated by waba-agent on ${escapeHtml(new Date().toISOString())}.</div>
  </body>
</html>`;
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

  e.command("summary")
    .description("export a one-page summary (HTML or JSON)")
    .option("--client <name>", "client name (default: active client)")
    .option("--since <dur>", "lookback window (default: 7d)", "7d")
    .option("--min-age <dur>", "missed lead min age (default: 10m)", "10m")
    .option("--out <path>", "HTML output path (default: ./summary_<client>_<YYYY-MM-DD>.html)")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();

      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const sinceMs = parseDurationMs(opts.since);
      const minAgeMs = parseDurationMs(opts.minAge);
      if (!sinceMs) throw new Error("Invalid --since. Example: 24h, 7d, 90m");
      if (!minAgeMs) throw new Error("Invalid --min-age. Example: 10m, 30s");

      const days = sinceMs / 86_400_000;
      const metrics = await computeMetrics({ client, days, pricing: cfg.pricing });
      const state = await readState(client);
      const flowStatuses = computeFlowStatusCounts(state, { cutoffMs: Date.now() - sinceMs });

      const events = await readMemory(client, { limit: 50_000 });
      const missedLeads = computeMissedLeadsFromEvents(events, { cutoffMs: Date.now() - sinceMs, minAgeMs });

      const summary = {
        client,
        window: {
          since: opts.since,
          start: dayjs().subtract(days, "day").toISOString(),
          end: new Date().toISOString()
        },
        metrics,
        flowStatuses,
        missedLeads
      };

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, summary }, null, 2));
        return;
      }

      const clientCfg = (await getClientConfig(client)) || {};
      const title = `WhatsApp Summary: ${clientCfg.businessName || client}`;
      const subtitle = `Window: last ${opts.since}`;
      const html = summaryHtml({ title, subtitle, summary });

      const outPath = opts.out || path.resolve(process.cwd(), `summary_${client}_${dayjs().format("YYYY-MM-DD")}.html`);
      await fs.ensureDir(path.dirname(outPath));
      await fs.writeFile(outPath, html, "utf8");
      logger.ok(`Wrote: ${outPath}`);
    });
}

module.exports = { registerExportCommands };
