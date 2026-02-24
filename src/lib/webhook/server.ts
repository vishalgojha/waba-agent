// @ts-nocheck
const http = require("http");
const { URL } = require("url");

const { logger } = require("../logger");
const { verifyHubSignature256 } = require("./signature");

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function createWebhookServer({ port = 3000, path = "/webhook", verifyToken, appSecret, onPost } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, `http://${req.headers.host}`);
      if (u.pathname !== path) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      if (req.method === "GET") {
        const mode = u.searchParams.get("hub.mode");
        const token = u.searchParams.get("hub.verify_token");
        const challenge = u.searchParams.get("hub.challenge");

        if (mode === "subscribe" && token && challenge && token === verifyToken) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/plain");
          res.end(challenge);
          return;
        }
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }

      if (req.method === "POST") {
        const raw = await readRawBody(req);
        const sig = req.headers["x-hub-signature-256"];
        const v = verifyHubSignature256({ appSecret, rawBody: raw, signatureHeader: sig });
        if (!v.ok) {
          res.statusCode = 401;
          res.end("Bad signature");
          return;
        }

        let payload;
        try {
          payload = JSON.parse(raw.toString("utf8"));
        } catch {
          res.statusCode = 400;
          res.end("Invalid JSON");
          return;
        }

        // Ack quickly.
        res.statusCode = 200;
        res.end("OK");

        // Process async.
        if (onPost) {
          Promise.resolve()
            .then(() => onPost(payload))
            .catch((err) => logger.error(err?.stack || String(err)));
        }
        return;
      }

      res.statusCode = 405;
      res.end("Method not allowed");
    } catch (err) {
      res.statusCode = 500;
      res.end("Server error");
      logger.error(err?.stack || String(err));
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

module.exports = { createWebhookServer };

