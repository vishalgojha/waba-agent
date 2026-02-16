function parseForwardedIp(req) {
  const header = req?.headers?.["x-forwarded-for"];
  if (!header) return null;
  const first = String(header).split(",")[0].trim();
  return first || null;
}

function requestIp(req) {
  return (
    parseForwardedIp(req)
    || req?.ip
    || req?.socket?.remoteAddress
    || req?.connection?.remoteAddress
    || "unknown"
  );
}

function requestClient(req, fallbackClient = "default") {
  return (
    req?.headers?.["x-waba-client"]
    || req?.query?.client
    || req?.body?.client
    || req?.params?.client
    || fallbackClient
    || "default"
  );
}

function getRequestClientKey(req, fallbackClient = "default") {
  const ip = String(requestIp(req));
  const client = String(requestClient(req, fallbackClient));
  return `${ip}|${client}`;
}

function createRateLimitMiddleware({
  windowMs = 60_000,
  max = 180,
  keyFn = (req) => requestIp(req),
  skip = null,
  onLimit = null,
  responseMessage = "rate_limit_exceeded"
} = {}) {
  const state = new Map();
  const cleanEvery = Math.max(250, Math.floor(windowMs));
  let lastCleanup = 0;

  return function rateLimitMiddleware(req, res, next) {
    if (typeof skip === "function" && skip(req)) {
      next();
      return;
    }

    const now = Date.now();
    const key = String(keyFn(req) || "unknown");
    const ttl = Math.max(1000, Number(windowMs) || 60_000);
    const cap = Math.max(1, Number(max) || 180);

    let bucket = state.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + ttl };
      state.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, cap - bucket.count);
    const resetSeconds = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));
    res.set("X-RateLimit-Limit", String(cap));
    res.set("X-RateLimit-Remaining", String(remaining));
    res.set("X-RateLimit-Reset", String(resetSeconds));

    if (bucket.count > cap) {
      if (typeof onLimit === "function") {
        try {
          onLimit({
            key,
            count: bucket.count,
            max: cap,
            windowMs: ttl,
            ip: requestIp(req),
            client: requestClient(req)
          });
        } catch {}
      }
      res.status(429).json({ ok: false, error: responseMessage, retry_after_seconds: resetSeconds });
      return;
    }

    if (now - lastCleanup > cleanEvery && state.size > 128) {
      for (const [k, v] of state.entries()) {
        if (!v || now >= v.resetAt) state.delete(k);
      }
      lastCleanup = now;
    }

    next();
  };
}

module.exports = {
  createRateLimitMiddleware,
  getRequestClientKey
};
