const dayjs = require("dayjs");

const { readMemory } = require("./memory");
const { readState } = require("./flow-state");
const { computeMetrics } = require("./analytics");
const { redactPhone } = require("./redact");

function statusFromConvo(convo) {
  if (!convo || typeof convo !== "object") return "pending";
  if (convo.completedAt && convo.handoff) return "handoff";
  if (convo.completedAt) return "qualified";
  if (convo.startedAt) return "in_progress";
  return "pending";
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

function lastTextSnippet(e) {
  const s = String(e?.text || e?.body || "");
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > 120 ? `${t.slice(0, 120)}...` : t;
}

function computeFlowStatusCounts(state, { cutoffMs } = {}) {
  const counts = { pending: 0, in_progress: 0, qualified: 0, handoff: 0 };
  for (const [_k, convo] of Object.entries(state || {})) {
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

function computeMissedLeadsFromEvents(events, { cutoffMs, minAgeMs = 10 * 60 * 1000 } = {}) {
  const now = Date.now();
  const minInboundTs = now - minAgeMs;
  const by = new Map(); // phone -> { phone, lastInboundAt, lastOutboundAt, lastInboundText }

  const ensure = (phone) => {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) return null;
    const cur = by.get(digits) || { phone: digits, lastInboundAt: null, lastOutboundAt: null, lastInboundText: "" };
    by.set(digits, cur);
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
  const intents = Object.entries(m?.funnel?.intents || {})
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .slice(0, 10);

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

async function buildSummaryReport({ client, sinceMs, minAgeMs, pricing, clientCfg, sinceLabel } = {}) {
  if (!client) throw new Error("Missing `client`.");
  if (!sinceMs) throw new Error("Missing `sinceMs`.");
  if (!minAgeMs) throw new Error("Missing `minAgeMs`.");

  const days = sinceMs / 86_400_000;
  const metrics = await computeMetrics({ client, days, pricing });
  const state = await readState(client);
  const flowStatuses = computeFlowStatusCounts(state, { cutoffMs: Date.now() - sinceMs });

  const events = await readMemory(client, { limit: 50_000 });
  const missedLeads = computeMissedLeadsFromEvents(events, { cutoffMs: Date.now() - sinceMs, minAgeMs });

  const summary = {
    client,
    window: {
      sinceMs,
      sinceLabel: sinceLabel || null,
      start: dayjs().subtract(sinceMs, "millisecond").toISOString(),
      end: new Date().toISOString()
    },
    metrics,
    flowStatuses,
    missedLeads
  };

  const title = `WhatsApp Summary: ${clientCfg?.businessName || clientCfg?.brandName || client}`;
  const subtitle = `Window: last ${sinceLabel || `${Math.round(days)}d`}`;
  const html = summaryHtml({ title, subtitle, summary });

  return { summary, html, title, subtitle };
}

module.exports = {
  buildSummaryReport,
  computeFlowStatusCounts,
  computeMissedLeadsFromEvents,
  summaryHtml
};

