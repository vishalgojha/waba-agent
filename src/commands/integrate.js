const axios = require("axios");

const { getClientConfig, setClientConfig } = require("../lib/client-config");
const { getConfig } = require("../lib/config");
const { logger } = require("../lib/logger");

function appsScriptTemplate() {
  // Simple JSON ingest endpoint. User deploys as web app (execute as: me, access: anyone with link).
  return `/**
 * Google Apps Script for WABA Agent lead sync
 * 1) Create a Google Sheet
 * 2) Extensions -> Apps Script, paste this
 * 3) Deploy -> New deployment -> Web app
 *    Execute as: Me
 *    Who has access: Anyone
 * 4) Copy the Web app URL and set it via:
 *    waba integrate google-sheets --apps-script-url "<URL>" --client <client>
 */
function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("leads") || ss.insertSheet("leads");
  var body = JSON.parse(e.postData.contents || "{}");
  var leads = body.leads || [];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["ts","client","from","text","intent","temperature","response_minutes"]);
  }
  for (var i = 0; i < leads.length; i++) {
    var l = leads[i];
    sheet.appendRow([l.ts, body.client || "", l.from || "", l.text || "", l.intent || "", l.temperature || "", l.responseMinutes || ""]);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ok:true, rows: leads.length}))
    .setMimeType(ContentService.MimeType.JSON);
}`;
}

function registerIntegrateCommands(program) {
  const i = program.command("integrate").description("integrations (CRM, sheets, webhooks)");

  i.command("google-sheets")
    .description("configure Google Sheets sync (recommended: Apps Script web app URL)")
    .option("--client <name>", "client name (default: active client)")
    .option("--apps-script-url <url>", "Apps Script Web App URL that accepts POST JSON")
    .option("--print-apps-script", "print an Apps Script template and exit", false)
    .option("--test", "send a small test payload to the configured URL", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      if (opts.printAppsScript) {
        if (json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ ok: true, appsScript: appsScriptTemplate() }, null, 2));
          return;
        }
        // eslint-disable-next-line no-console
        console.log(appsScriptTemplate());
        return;
      }

      if (opts.appsScriptUrl) {
        await setClientConfig(client, { integrations: { googleSheets: { appsScriptUrl: opts.appsScriptUrl } } });
        logger.ok(`Saved Google Sheets integration for client '${client}'`);
      }

      const clientCfg = (await getClientConfig(client)) || {};
      const url = clientCfg.integrations?.googleSheets?.appsScriptUrl;
      if (!url) throw new Error("Missing Apps Script URL. Use --apps-script-url or --print-apps-script.");

      if (opts.test) {
        const payload = {
          client,
          leads: [
            { ts: new Date().toISOString(), from: "9199***9999", text: "test lead", intent: "greeting", temperature: "warm", responseMinutes: 2.5 }
          ]
        };
        const res = await axios.post(url, payload, { timeout: 20_000 });
        if (json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ ok: true, status: res.status, data: res.data }, null, 2));
          return;
        }
        logger.ok(`Test OK (HTTP ${res.status})`);
        logger.info(JSON.stringify(res.data, null, 2));
      } else if (!json) {
        logger.info(`Google Sheets Apps Script URL configured for '${client}'. Use: waba sync leads --to sheets --client ${client}`);
      }
    });
}

module.exports = { registerIntegrateCommands };

