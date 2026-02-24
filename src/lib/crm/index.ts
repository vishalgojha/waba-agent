// @ts-nocheck
const { pushToWebhook } = require("./webhook");
const { hubspotUpsertContact } = require("./hubspot");
const { zohoCreateLead } = require("./zoho");

function hasAnyCrm(integrations) {
  const i = integrations || {};
  return !!(i.webhook?.url || i.hubspot?.accessToken || i.zoho?.accessToken);
}

async function pushLeadToCrm({ client, clientCfg, lead, only } = {}) {
  const integrations = clientCfg?.integrations || {};
  const results = [];

  const want = (name) => {
    if (!only) return true;
    const x = Array.isArray(only) ? only : [only];
    return x.includes(name);
  };

  if (want("webhook") && integrations.webhook?.url) {
    try {
      const out = await pushToWebhook({ url: integrations.webhook.url, lead });
      results.push({ provider: "webhook", ok: true, out });
    } catch (err) {
      results.push({ provider: "webhook", ok: false, error: String(err?.message || err) });
    }
  }

  if (want("hubspot") && integrations.hubspot?.accessToken) {
    try {
      const out = await hubspotUpsertContact({ accessToken: integrations.hubspot.accessToken, lead });
      results.push({ provider: "hubspot", ok: true, out });
    } catch (err) {
      results.push({ provider: "hubspot", ok: false, error: String(err?.message || err) });
    }
  }

  if (want("zoho") && integrations.zoho?.accessToken) {
    try {
      const out = await zohoCreateLead({
        accessToken: integrations.zoho.accessToken,
        dc: integrations.zoho.dc || "in",
        module: integrations.zoho.module || "Leads",
        lead
      });
      results.push({ provider: "zoho", ok: true, out });
    } catch (err) {
      results.push({ provider: "zoho", ok: false, error: String(err?.message || err) });
    }
  }

  return { ok: results.every((r) => r.ok), client, results };
}

module.exports = { hasAnyCrm, pushLeadToCrm };
