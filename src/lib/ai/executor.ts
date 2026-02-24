// @ts-nocheck
const crypto = require("crypto");
const dayjs = require("dayjs");

const { getConfig, setConfig } = require("../config");
const { requireClientCreds, safeClientName } = require("../creds");
const { WhatsAppCloudApi } = require("../whatsapp");
const { isOptedOut } = require("../optout-store");
const { appendMemory, readMemory } = require("../memory");
const { readSchedules, writeSchedules, newId } = require("../schedule-store");
const { logger } = require("../logger");

function normalizeToWaNumber(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildApi(cfg, client) {
  const creds = requireClientCreds(cfg, client);
  return {
    client: creds.client,
    api: new WhatsAppCloudApi({
      token: creds.token,
      phoneNumberId: creds.phoneNumberId,
      wabaId: creds.wabaId,
      graphVersion: cfg.graphVersion || "v20.0",
      baseUrl: cfg.baseUrl
    })
  };
}

async function executeSendTemplate(intent, cfg) {
  const { client, api } = buildApi(cfg, intent.client);
  const to = normalizeToWaNumber(intent.phone);
  if (await isOptedOut(client, to)) {
    throw new Error("Recipient is opted out. Use `waba optout check <number>` to verify.");
  }
  const result = await api.sendTemplate({
    to,
    templateName: intent.template,
    language: "en",
    params: intent.params || undefined
  });
  await appendMemory(client, {
    type: "outbound_sent",
    kind: "template",
    to,
    templateName: intent.template,
    params: intent.params || null,
    source: "ai"
  });
  return result;
}

async function executeSendText(intent, cfg) {
  const { client, api } = buildApi(cfg, intent.client);
  const to = normalizeToWaNumber(intent.phone);
  if (await isOptedOut(client, to)) {
    throw new Error("Recipient is opted out. Use `waba optout check <number>` to verify.");
  }
  const result = await api.sendText({ to, body: intent.message, previewUrl: false });
  await appendMemory(client, {
    type: "outbound_sent",
    kind: "text",
    to,
    body: intent.message,
    source: "ai"
  });
  return result;
}

async function executeScheduleText(intent, cfg) {
  const client = safeClientName(intent.client || cfg.activeClient || "default");
  const dt = dayjs(intent.datetime);
  const list = await readSchedules();
  const item = {
    id: newId(),
    kind: "text",
    to: normalizeToWaNumber(intent.phone),
    body: intent.message,
    runAt: dt.toISOString(),
    status: "pending",
    createdAt: new Date().toISOString(),
    client
  };
  list.push(item);
  const path = await writeSchedules(list);
  await appendMemory(client, { type: "schedule_added", item, source: "ai" });
  return { path, item };
}

async function executeScheduleTemplate(intent, cfg) {
  const client = safeClientName(intent.client || cfg.activeClient || "default");
  const dt = dayjs(intent.datetime);
  const list = await readSchedules();
  const item = {
    id: newId(),
    kind: "template",
    to: normalizeToWaNumber(intent.phone),
    templateName: intent.template,
    language: "en",
    params: intent.params || [],
    category: "utility",
    runAt: dt.toISOString(),
    status: "pending",
    createdAt: new Date().toISOString(),
    client
  };
  list.push(item);
  const path = await writeSchedules(list);
  await appendMemory(client, { type: "schedule_added", item, source: "ai" });
  return { path, item };
}

async function executeListTemplates(intent, cfg) {
  const { api } = buildApi(cfg, intent.client);
  const data = await api.listTemplates({ limit: 100 });
  return data?.data || [];
}

async function executeWebhookSetup(intent, cfg) {
  const url = String(intent.message || "").match(/https?:\/\/\S+/i)?.[0];
  if (!url) throw new Error("Missing public URL for webhook setup. Include a URL like https://abc.ngrok.app.");
  const verifyToken = base64url(crypto.randomBytes(24));
  const normalized = String(url).replace(/\/+$/, "");
  const callbackUrl = `${normalized}/webhook`;
  await setConfig({ webhookVerifyToken: verifyToken });
  return {
    callbackUrl,
    verifyToken,
    metaSteps: [
      "Go to Meta Developers > Your App > WhatsApp > Configuration",
      `Set Callback URL to: ${callbackUrl}`,
      "Set Verify Token to the generated value",
      "Subscribe to webhook fields: messages, message_status"
    ],
    previousTokenExisted: !!cfg.webhookVerifyToken
  };
}

async function executeShowMemory(intent, cfg) {
  const client = safeClientName(intent.client || cfg.activeClient || "default");
  return readMemory(client, { limit: 50 });
}

async function executeIntent(intent, options = {}) {
  try {
    const cfg = options.config || await getConfig();
    const action = intent?.action;
    if (!options.quiet) logger.debug({ aiExecute: { action, client: intent?.client || cfg.activeClient || "default" } });

    let result;
    if (action === "send_template") result = await executeSendTemplate(intent, cfg);
    else if (action === "send_text") result = await executeSendText(intent, cfg);
    else if (action === "schedule_text") result = await executeScheduleText(intent, cfg);
    else if (action === "schedule_template") result = await executeScheduleTemplate(intent, cfg);
    else if (action === "list_templates") result = await executeListTemplates(intent, cfg);
    else if (action === "webhook_setup") result = await executeWebhookSetup(intent, cfg);
    else if (action === "show_memory") result = await executeShowMemory(intent, cfg);
    else throw new Error(`Unsupported action: ${action}`);

    return { success: true, result, error: null };
  } catch (err) {
    if (!options.quiet) logger.error(`AI execution failed: ${err?.message || err}`);
    return { success: false, result: null, error: String(err?.message || err) };
  }
}

module.exports = { executeIntent };
