// @ts-nocheck
function safeClientName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default";
}

function getClientName(cfg, clientOpt) {
  return safeClientName(clientOpt || cfg.activeClient || "default");
}

function getClientCreds(cfg, clientName) {
  const name = getClientName(cfg, clientName);
  const clientObj = (cfg.clients && typeof cfg.clients === "object" ? cfg.clients[name] : null) || {};
  const token = clientObj.token || cfg.token || null;
  const phoneNumberId = clientObj.phoneNumberId || cfg.phoneNumberId || null;
  const wabaId = clientObj.wabaId || cfg.wabaId || null;
  return { client: name, token, phoneNumberId, wabaId };
}

function requireClientCreds(cfg, clientName) {
  const c = getClientCreds(cfg, clientName);
  if (!c.token) {
    throw new Error(
      `Missing token for client '${c.client}'. Set via: waba clients add ${c.client} --token <TOKEN> --phone-id <PHONE_ID> --business-id <WABA_ID> --switch`
    );
  }
  if (!c.phoneNumberId) {
    throw new Error(
      `Missing phoneNumberId for client '${c.client}'. Set via: waba clients add ${c.client} --token <TOKEN> --phone-id <PHONE_ID> --business-id <WABA_ID> --switch`
    );
  }
  // wabaId is required for template management, but not strictly for sending messages.
  return c;
}

module.exports = {
  safeClientName,
  getClientName,
  getClientCreds,
  requireClientCreds
};

