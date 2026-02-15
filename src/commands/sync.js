const axios = require("axios");

const { getConfig } = require("../lib/config");
const { getClientConfig } = require("../lib/client-config");
const { computeMetrics } = require("../lib/analytics");
const { readMemory } = require("../lib/memory");
const { ruleBasedIntent } = require("../lib/message-parser");
const { logger } = require("../lib/logger");

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
      from: redactPhone(e.from),
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
    .description("sync leads to an integration (currently: sheets)")
    .requiredOption("--to <dest>", "destination: sheets")
    .option("--client <name>", "client name (default: active client)")
    .option("--days <n>", "lookback window", (v) => Number(v), 30)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const to = String(opts.to || "").toLowerCase();

      if (to !== "sheets") throw new Error("Unsupported --to. Use --to sheets.");

      const clientCfg = (await getClientConfig(client)) || {};
      const url = clientCfg.integrations?.googleSheets?.appsScriptUrl;
      if (!url) throw new Error("Google Sheets integration not configured. Run: waba integrate google-sheets --apps-script-url <URL>");

      const { rows } = await buildLeads({ client, days: opts.days });
      const payload = { client, leads: rows };

      logger.info(`Syncing ${rows.length} lead row(s) -> sheets`);
      const res = await axios.post(url, payload, { timeout: 60_000 });

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, status: res.status, data: res.data }, null, 2));
        return;
      }
      logger.ok(`Synced (HTTP ${res.status})`);
      logger.info(JSON.stringify(res.data, null, 2));
    });
}

module.exports = { registerSyncCommands };

