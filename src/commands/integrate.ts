// @ts-nocheck
const axios = require("axios");

const { getClientConfig, setClientConfig } = require("../lib/client-config");
const { getConfig } = require("../lib/config");
const { logger } = require("../lib/logger");
const { zohoBaseUrl } = require("../lib/crm/zoho");

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

  i.command("status")
    .description("show configured integrations for a client (redacted)")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const clientCfg = (await getClientConfig(client)) || {};
      const integ = clientCfg.integrations || {};

      const out = {
        client,
        googleSheets: integ.googleSheets?.appsScriptUrl ? "***set***" : null,
        webhook: integ.webhook?.url ? "***set***" : null,
        hubspot: integ.hubspot?.accessToken ? "***set***" : null,
        zoho: integ.zoho?.accessToken ? `***set*** (${integ.zoho.dc || "in"})` : null
      };
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, out }, null, 2));
        return;
      }
      logger.info(JSON.stringify(out, null, 2));
    });

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

  i.command("webhook")
    .description("configure generic CRM webhook sink (POST JSON)")
    .option("--client <name>", "client name (default: active client)")
    .requiredOption("--url <url>", "webhook URL to receive lead payloads")
    .option("--test", "send a test lead payload to the webhook", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      await setClientConfig(client, { integrations: { webhook: { url: opts.url } } });
      if (!json) logger.ok(`Saved webhook integration for client '${client}'`);

      if (opts.test) {
        const payload = { event: "lead_test", client, from: "919999999999", name: "Test Lead", text: "Hello", ts: new Date().toISOString() };
        const res = await axios.post(opts.url, payload, { timeout: 20_000 });
        if (json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ ok: true, status: res.status, data: res.data }, null, 2));
          return;
        }
        logger.ok(`Test OK (HTTP ${res.status})`);
        logger.info(JSON.stringify(res.data, null, 2));
      }
    });

  i.command("hubspot")
    .description("configure HubSpot CRM (upsert contact by phone)")
    .option("--client <name>", "client name (default: active client)")
    .requiredOption("--token <token>", "HubSpot private app token (Bearer)")
    .option("--test", "create/update a test contact", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      await setClientConfig(client, { integrations: { hubspot: { accessToken: opts.token } } });
      if (!json) logger.ok(`Saved HubSpot integration for client '${client}'`);

      if (opts.test) {
        const { hubspotUpsertContact } = require("../lib/crm/hubspot");
        const out = await hubspotUpsertContact({
          accessToken: opts.token,
          lead: { from: "919999999999", phone: "919999999999", name: "Test Lead", text: "HubSpot test" }
        });
        if (json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ ok: true, out }, null, 2));
          return;
        }
        logger.ok(`HubSpot test: ${out.action} id=${out.id || "-"}`);
      }
    });

  i.command("zoho")
    .description("configure Zoho CRM (create lead record)")
    .option("--client <name>", "client name (default: active client)")
    .requiredOption("--token <token>", "Zoho OAuth access token")
    .option("--dc <in|com|eu|au|jp>", "Zoho data center (default: in)", "in")
    .option("--module <name>", "module name (default: Leads)", "Leads")
    .option("--test", "create a test lead record", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      await setClientConfig(client, { integrations: { zoho: { accessToken: opts.token, dc: opts.dc, module: opts.module } } });
      if (!json) logger.ok(`Saved Zoho integration for client '${client}' (${zohoBaseUrl(opts.dc)})`);

      if (opts.test) {
        const { zohoCreateLead } = require("../lib/crm/zoho");
        const out = await zohoCreateLead({
          accessToken: opts.token,
          dc: opts.dc,
          module: opts.module,
          lead: { from: "919999999999", phone: "919999999999", name: "Test Lead", text: "Zoho test", company: "WhatsApp" }
        });
        if (json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ ok: true, out }, null, 2));
          return;
        }
        logger.ok("Zoho test: created");
        logger.info(JSON.stringify(out.record || out.data, null, 2));
      }
    });
}

module.exports = { registerIntegrateCommands };
