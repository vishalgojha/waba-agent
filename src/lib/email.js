function getNodemailer() {
  try {
    // Lazy-require so the CLI can still run if deps weren't installed correctly.
    // This also avoids crashing on startup for users who don't use email features.
    // eslint-disable-next-line global-require
    return require("nodemailer");
  } catch (err) {
    const msg =
      err?.code === "MODULE_NOT_FOUND"
        ? "Missing dependency 'nodemailer'."
        : `Failed to load 'nodemailer': ${err?.message || err}`;
    throw new Error(`${msg} Run: npm i (or npm.cmd i on Windows PowerShell).`);
  }
}

function boolEnv(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return String(v).trim().toLowerCase() === "true" || String(v).trim() === "1";
}

function numberEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getSmtpConfig() {
  const url = process.env.WABA_SMTP_URL || process.env.SMTP_URL || null;
  if (url) return { url };

  const host = process.env.WABA_SMTP_HOST || process.env.SMTP_HOST || null;
  const port = numberEnv("WABA_SMTP_PORT", numberEnv("SMTP_PORT", 587));
  const secure = boolEnv("WABA_SMTP_SECURE", boolEnv("SMTP_SECURE", false));
  const user = process.env.WABA_SMTP_USER || process.env.SMTP_USER || null;
  const pass = process.env.WABA_SMTP_PASS || process.env.SMTP_PASS || null;
  const from = process.env.WABA_SMTP_FROM || process.env.SMTP_FROM || null;

  return { host, port, secure, user, pass, from };
}

function createTransport() {
  const cfg = getSmtpConfig();
  const nodemailer = getNodemailer();
  if (cfg.url) return nodemailer.createTransport(cfg.url);

  if (!cfg.host) throw new Error("Missing SMTP config. Set WABA_SMTP_URL or WABA_SMTP_HOST/WABA_SMTP_USER/WABA_SMTP_PASS.");
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined
  });
}

async function sendEmail({ to, subject, html, text, cc, bcc, from }) {
  const cfg = getSmtpConfig();
  const transport = createTransport();
  const fromFinal = from || cfg.from;
  if (!fromFinal) throw new Error("Missing FROM address. Set WABA_SMTP_FROM (or pass --from).");

  const info = await transport.sendMail({
    from: fromFinal,
    to,
    cc,
    bcc,
    subject,
    text,
    html
  });
  return info;
}

module.exports = { getSmtpConfig, sendEmail };
