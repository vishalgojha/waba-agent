const fs = require("fs-extra");
const path = require("path");

const { campaignsDir } = require("./paths");

function campaignPath(id) {
  return path.join(campaignsDir(), `${id}.json`);
}

function newCampaignId() {
  return `cmp_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

async function listCampaigns() {
  if (!(await fs.pathExists(campaignsDir()))) return [];
  const files = (await fs.readdir(campaignsDir())).filter((f) => f.endsWith(".json"));
  const out = [];
  for (const f of files) {
    try {
      const data = await fs.readJson(path.join(campaignsDir(), f));
      out.push(data);
    } catch {}
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

async function loadCampaign(id) {
  const p = campaignPath(id);
  if (!(await fs.pathExists(p))) throw new Error(`Campaign not found: ${id}`);
  const data = await fs.readJson(p);
  return { path: p, campaign: data };
}

async function saveCampaign(campaign) {
  await fs.ensureDir(campaignsDir());
  const p = campaignPath(campaign.id);
  await fs.writeJson(p, campaign, { spaces: 2 });
  try {
    await fs.chmod(p, 0o600);
  } catch {}
  return p;
}

async function createCampaign({ name, client, templateName, language, category }) {
  const id = newCampaignId();
  const campaign = {
    id,
    name,
    client,
    createdAt: new Date().toISOString(),
    status: "draft",
    template: {
      name: templateName,
      language: language || "en",
      category: category || "marketing"
    },
    audience: [],
    scheduledAt: null,
    progress: {
      processed: 0,
      sent: 0,
      failed: 0,
      optedOut: 0,
      lastIndex: 0
    },
    lastRunAt: null,
    stoppedAt: null
  };
  const p = await saveCampaign(campaign);
  return { path: p, campaign };
}

module.exports = {
  campaignPath,
  newCampaignId,
  listCampaigns,
  loadCampaign,
  saveCampaign,
  createCampaign
};

