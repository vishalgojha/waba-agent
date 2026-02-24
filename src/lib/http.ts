// @ts-nocheck
const axios = require("axios");

const { logger } = require("./logger");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterSeconds(v) {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return n;
  return null;
}

function createHttpClient({ baseURL, token, timeoutMs = 30_000, userAgent = "waba-agent/0.1.0" }) {
  const client = axios.create({
    baseURL,
    timeout: timeoutMs,
    headers: {
      "User-Agent": userAgent,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  // Basic, conservative retry policy: 429 + transient 5xx.
  client.interceptors.response.use(
    (res) => res,
    async (err) => {
      const cfg = err.config || {};
      const status = err.response?.status;
      const retriable = status === 429 || (status >= 500 && status <= 599);
      cfg.__retryCount = cfg.__retryCount || 0;

      if (!retriable || cfg.__retryCount >= 5) throw err;

      cfg.__retryCount += 1;
      const retryAfter = parseRetryAfterSeconds(err.response?.headers?.["retry-after"]);
      const backoff = retryAfter != null
        ? retryAfter * 1000
        : Math.min(30_000, 500 * 2 ** (cfg.__retryCount - 1));
      const jitter = Math.floor(Math.random() * 250);
      const waitMs = backoff + jitter;

      logger.warn(`HTTP ${status} retry ${cfg.__retryCount}/5 in ${waitMs}ms: ${cfg.method?.toUpperCase()} ${cfg.url}`);
      await sleep(waitMs);
      return client.request(cfg);
    }
  );

  return client;
}

module.exports = { createHttpClient };

