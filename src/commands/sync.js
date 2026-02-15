const axios = require("axios");

const { getConfig } = require("../lib/config");
const { getClientConfig } = require("../lib/client-config");
const { computeMetrics } = require("../lib/analytics");
const { readMemory } = require("../lib/memory");
const { ruleBasedIntent } = require("../lib/message-parser");
const { logger } = require("../lib/logger");
const { pushLeadToCrm } = require("../lib/crm");

function redactPhone(s) {
  const t = String(s || "");
  if (t.length <= 6) return "***";
  return `${t.slice(0, 2)}***${t.slice(-4)}`;
}

async function buildLeads({ client, days }) {
  const events = await readMemory(client, { limit: 50_000 });
  const metrics = await computeMetrics({ client, days });
  // Very simple "lead rows": last N inbound messages (unique by message ts+from+text).
  const seen = new Set();
  const rows = [];
  for (const e of events) {
    if (e.type !== "inbound_message" && e.type !== "inbound_text") continue;
    const key = `${e.ts}|${e.from}|${e.text || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const text = e.text || "";
    const intent = ruleBasedIntent(text).intent;
    rows.push({
      ts: e.ts,
      from: e.from,
      from_redacted: redactPhone(e.from),
      text: String(text).slice(0, 500),
      intent,
      temperature: null,
      responseMinutes: null
    });
  }
  // Keep it bounded for a simple sync.
  rows.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return { rows: rows.slice(0, 500), metrics };
}

function registerSyncCommands(program) {
  const s = program.command("sync").description("sync local lead data to integrations");

  s.command("leads")
    .description("sync leads to an integration (sheets|hubspot|zoho|webhook)")
    .requiredOption("--to <dest>", "destination: sheets|hubspot|zoho|webhook")
    .option("--client <name>", "client name (default: active client)")
    .option("--days <n>", "lookback window", (v) => Number(v), 30)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const to = String(opts.to || "").toLowerCase();

      const clientCfg = (await getClientConfig(client)) || {};
      const { rows } = await buildLeads({ client, days: opts.days });

      if (to === "sheets") {
        const url = clientCfg.integrations?.googleSheets?.appsScriptUrl;
        if (!url) throw new Error("Google Sheets integration not configured. Run: waba integrate google-sheets --apps-script-url <URL>");
        const payload = {
          client,
          leads: rows.map((r) => ({ ...r, from: r.from_redacted }))
        };
        logger.info(`Syncing ${rows.length} lead row(s) -> sheets`);
        const res = await axios.post(url, payload, { timeout: 60_000 });
        if (json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ ok: true, status: res.status, data: res.data }, null, 2));
          return;
        }
        logger.ok(`Synced (HTTP ${res.status})`);
        logger.info(JSON.stringify(res.data, null, 2));
        return;
      }

      if (to === "hubspot" || to === "zoho" || to === "webhook") {
        logger.info(`Syncing ${rows.length} lead row(s) -> ${to}`);
        const results = [];
        for (const r of rows) {
          const lead = {
            event: "lead_sync",
            client,
            from: r.from,
            phone: r.from,
            name: null,
            text: r.text,
            intent: r.intent,
            ts: r.ts
          };
          const out = await pushLeadToCrm({ client, clientCfg, lead, only: [to] });
          results.push({ from: r.from_redacted, ok: out.ok, results: out.results });
        }
        if (json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ ok: true, to, client, results }, null, 2));
          return;
        }
        const okCount = results.filter((x) => x.ok).length;
        logger.ok(`Synced: ${okCount}/${results.length}`);
        return;
      }

      throw new Error("Unsupported --to. Use sheets|hubspot|zoho|webhook.");
    });
}

module.exports = { registerSyncCommands };
