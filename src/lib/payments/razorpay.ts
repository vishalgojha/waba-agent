// @ts-nocheck
const crypto = require("crypto");

function getRazorpayCtor() {
  try {
    // eslint-disable-next-line global-require
    return require("razorpay");
  } catch (err) {
    const msg =
      err?.code === "MODULE_NOT_FOUND"
        ? "Missing dependency 'razorpay'."
        : `Failed to load 'razorpay': ${err?.message || err}`;
    throw new Error(`${msg} Run: npm i (or npm.cmd i on Windows PowerShell).`);
  }
}

function getRazorpayClient({ keyId, keySecret }) {
  if (!keyId || !keySecret) throw new Error("Missing Razorpay credentials.");
  const Razorpay = getRazorpayCtor();
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function inrToPaise(amountInr) {
  const n = Number(amountInr);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Invalid amount.");
  return Math.round(n * 100);
}

function verifyRazorpayWebhook({ secret, rawBody, signature }) {
  const mac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = String(signature || "");
  const a = Buffer.from(mac, "utf8");
  const b = Buffer.from(got, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function createPaymentLink({ keyId, keySecret, amountInr, description, customer, notes, callbackUrl }) {
  const rzp = getRazorpayClient({ keyId, keySecret });

  const payload = {
    amount: inrToPaise(amountInr),
    currency: "INR",
    description: String(description || "Payment"),
    ...(customer ? { customer } : {}),
    ...(notes ? { notes } : {}),
    ...(callbackUrl ? { callback_url: callbackUrl, callback_method: "get" } : {})
  };

  const link = await rzp.paymentLink.create(payload);
  return link;
}

module.exports = {
  getRazorpayClient,
  createPaymentLink,
  verifyRazorpayWebhook
};
