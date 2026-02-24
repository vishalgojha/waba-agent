// @ts-nocheck
const dayjs = require("dayjs");

const { isOptedOut } = require("./optout-store");
const { saveCampaign } = require("./campaign-store");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeNumber(x) {
  const t = String(x || "").trim().replace(/^\+/, "");
  return t.replace(/[^0-9]/g, "");
}

async function runCampaignOnce({ campaign, config, whatsapp, throttleMs = 350, stopOptoutRate = null } = {}) {
  if (campaign.status === "stopped") return { ok: false, reason: "stopped" };
  if (!campaign.template?.name) throw new Error("Campaign missing template name.");

  const client = campaign.client || config.activeClient || "default";
  const aud = Array.isArray(campaign.audience) ? campaign.audience : [];
  const startIndex = campaign.progress?.lastIndex || 0;

  const results = [];
  let processed = 0;
  let sent = 0;
  let failed = 0;
  let optedOut = 0;

  for (let i = startIndex; i < aud.length; i++) {
    const raw = aud[i];
    const to = normalizeNumber(raw);
    if (!to) {
      campaign.progress.lastIndex = i + 1;
      continue;
    }

    processed += 1;

    if (await isOptedOut(client, to)) {
      optedOut += 1;
      results.push({ to, ok: false, skipped: "opted_out" });
      campaign.progress.lastIndex = i + 1;
      campaign.progress.processed += 1;
      campaign.progress.optedOut += 1;
      await saveCampaign(campaign);
      continue;
    }

    try {
      await whatsapp.sendTemplate({
        to,
        templateName: campaign.template.name,
        language: campaign.template.language || "en",
        params: campaign.template.params || []
      });
      sent += 1;
      results.push({ to, ok: true });
      campaign.progress.sent += 1;
    } catch (err) {
      failed += 1;
      results.push({ to, ok: false, error: String(err?.message || err) });
      campaign.progress.failed += 1;
    }

    campaign.progress.processed += 1;
    campaign.progress.lastIndex = i + 1;
    campaign.lastRunAt = new Date().toISOString();
    await saveCampaign(campaign);

    if (stopOptoutRate != null) {
      const total = campaign.progress.processed || 1;
      const rate = (campaign.progress.optedOut || 0) / total;
      if (rate >= stopOptoutRate) {
        campaign.status = "stopped";
        campaign.stoppedAt = new Date().toISOString();
        await saveCampaign(campaign);
        return { ok: false, reason: "optout_rate_stop", rate };
      }
    }

    await sleep(throttleMs);
  }

  if ((campaign.progress.lastIndex || 0) >= aud.length) {
    campaign.status = "completed";
    await saveCampaign(campaign);
  }

  return { ok: true, processed, sent, failed, optedOut, resultsCount: results.length };
}

function dueToRun(campaign) {
  if (!campaign.scheduledAt) return true;
  const d = dayjs(campaign.scheduledAt);
  if (!d.isValid()) return true;
  return d.isBefore(dayjs());
}

module.exports = { runCampaignOnce, dueToRun };

