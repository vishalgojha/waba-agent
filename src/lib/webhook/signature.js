const crypto = require("crypto");

function timingSafeEqualHex(a, b) {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyHubSignature256({ appSecret, rawBody, signatureHeader }) {
  if (!appSecret) return { ok: true, skipped: true };
  const h = signatureHeader || "";
  const prefix = "sha256=";
  if (!h.startsWith(prefix)) return { ok: false, reason: "missing_sha256_prefix" };
  const got = h.slice(prefix.length);
  const mac = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const ok = timingSafeEqualHex(mac, got);
  return ok ? { ok: true } : { ok: false, reason: "signature_mismatch" };
}

module.exports = { verifyHubSignature256 };

