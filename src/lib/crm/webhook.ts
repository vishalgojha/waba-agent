// @ts-nocheck
const axios = require("axios");

async function pushToWebhook({ url, lead, timeoutMs = 20_000 } = {}) {
  if (!url) throw new Error("Missing webhook URL.");
  const res = await axios.post(url, lead, {
    timeout: timeoutMs,
    headers: { "Content-Type": "application/json" }
  });
  return { status: res.status, data: res.data };
}

module.exports = { pushToWebhook };

