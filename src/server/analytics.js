const express = require("express");

const { logger } = require("../lib/logger");
const { computeMetrics } = require("../lib/analytics");
const { getConfig } = require("../lib/config");

function pageHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WABA Agent Analytics</title>
    <style>
      body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; margin: 24px; }
      .row { display: flex; gap: 16px; flex-wrap: wrap; }
      .card { border: 1px solid #ddd; border-radius: 10px; padding: 12px 14px; min-width: 240px; }
      h1 { margin: 0 0 8px 0; font-size: 18px; }
      h2 { margin: 0 0 10px 0; font-size: 14px; color: #444; }
      .muted { color: #666; font-size: 12px; }
      pre { background: #fafafa; border: 1px solid #eee; padding: 12px; border-radius: 10px; overflow: auto; }
      input, select { font: inherit; padding: 6px 8px; }
      button { font: inherit; padding: 6px 10px; }
    </style>
  </head>
  <body>
    <h1>WABA Agent Analytics</h1>
    <div class="muted">Local dashboard. This does not call Meta directly; it reads your local memory logs.</div>
    <div style="height: 10px"></div>
    <div class="row">
      <div class="card">
        <h2>Controls</h2>
        <div class="muted">Client</div>
        <input id="client" value="default" />
        <div style="height: 8px"></div>
        <div class="muted">Days</div>
        <input id="days" value="30" />
        <div style="height: 12px"></div>
        <button id="refresh">Refresh</button>
      </div>
      <div class="card">
        <h2>Lead Volume</h2>
        <div id="leadVolume">-</div>
      </div>
      <div class="card">
        <h2>Response Times</h2>
        <div id="respTimes">-</div>
      </div>
      <div class="card">
        <h2>Costs (Estimate)</h2>
        <div id="costs">-</div>
      </div>
    </div>
    <div style="height: 16px"></div>
    <div class="card">
      <h2>Raw JSON</h2>
      <pre id="raw">{}</pre>
    </div>
    <script>
      async function load() {
        const client = document.getElementById("client").value || "default";
        const days = document.getElementById("days").value || "30";
        const res = await fetch("/api/metrics?client=" + encodeURIComponent(client) + "&days=" + encodeURIComponent(days));
        const data = await res.json();
        document.getElementById("raw").textContent = JSON.stringify(data, null, 2);
        const m = data.metrics;
        document.getElementById("leadVolume").textContent = m ? (m.leads.inboundMessages + " inbound, " + m.leads.uniqueSenders + " unique") : "-";
        document.getElementById("respTimes").textContent = m ? ("avg " + (m.responses.avgMinutes?.toFixed?.(1) ?? "-") + "m, p50 " + (m.responses.p50Minutes?.toFixed?.(1) ?? "-") + "m, p90 " + (m.responses.p90Minutes?.toFixed?.(1) ?? "-") + "m") : "-";
        document.getElementById("costs").textContent = m ? ("known INR " + (m.costs.inr.totalKnown?.toFixed?.(2) ?? "-") + " (" + m.costs.messages.total + " msgs)") : "-";
      }
      document.getElementById("refresh").addEventListener("click", load);
      load().catch(err => { document.getElementById("raw").textContent = String(err); });
    </script>
  </body>
</html>`;
}

async function startAnalyticsServer({ host = "127.0.0.1", port = 3001 } = {}) {
  const cfg = await getConfig();
  const app = express();

  app.get("/", (_req, res) => res.status(200).type("text/html").send(pageHtml()));

  app.get("/api/metrics", async (req, res) => {
    try {
      const client = String(req.query.client || cfg.activeClient || "default");
      const days = Number(req.query.days || 30);
      const metrics = await computeMetrics({ client, days, pricing: cfg.pricing });
      res.json({ ok: true, metrics });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(port, host, () => resolve(s));
  });
  logger.ok(`Analytics dashboard: http://${host}:${port}/`);
  return { server };
}

module.exports = { startAnalyticsServer };

