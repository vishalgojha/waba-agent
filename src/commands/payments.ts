// @ts-nocheck
const express = require("express");
const bodyParser = require("body-parser");

const { getConfig } = require("../lib/config");
const { getClientConfig, setClientConfig } = require("../lib/client-config");
const { createAgentContext } = require("../lib/agent/agent");
const { logger } = require("../lib/logger");
const { createPaymentLink, verifyRazorpayWebhook } = require("../lib/payments/razorpay");
const { pushLeadToCrm, hasAnyCrm } = require("../lib/crm");
const { askYesNo } = require("../lib/prompt");

function registerPaymentsCommands(program) {
  const p = program.command("payments").description("India payments (Razorpay)");

  p.command("enable")
    .description("enable Razorpay for a client (stores creds in client config)")
    .argument("<provider>", "provider: razorpay")
    .requiredOption("--key <id>", "Razorpay key_id")
    .requiredOption("--secret <secret>", "Razorpay key_secret")
    .option("--webhook-secret <secret>", "Razorpay webhook signing secret (recommended)")
    .option("--client <name>", "client name (default: active client)")
    .action(async (provider, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      if (provider !== "razorpay") throw new Error("Only razorpay supported.");
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      await setClientConfig(client, {
        payments: {
          razorpay: {
            keyId: opts.key,
            keySecret: opts.secret,
            webhookSecret: opts.webhookSecret || null
          }
        }
      });

      const out = { client, provider, saved: true };
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, out }, null, 2));
        return;
      }
      logger.ok(`Razorpay enabled for '${client}'`);
      logger.warn("Security: key secret is stored in local client config. For production, move to env vars or secret manager.");
    });

  p.command("send-link")
    .description("create a Razorpay payment link and send to a WhatsApp number (high risk: outbound)")
    .requiredOption("--to <number>", "recipient number (E.164 without +)")
    .requiredOption("--amount <inr>", "amount in INR", (v) => Number(v))
    .requiredOption("--desc <text>", "description")
    .option("--client <name>", "client name (default: active client)")
    .option("--name <text>", "customer name")
    .option("--email <email>", "customer email")
    .option("--callback-url <url>", "callback URL after payment")
    .option("--notes <json>", "JSON object notes to store on payment link")
    .option("--yes", "skip confirmation prompt before sending WhatsApp message", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json, memory } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const clientCfg = (await getClientConfig(client)) || {};
      const rp = clientCfg.payments?.razorpay;
      if (!rp?.keyId || !rp?.keySecret) {
        throw new Error(`Razorpay not configured for '${client}'. Run: waba payments enable razorpay --key ... --secret ... --client ${client}`);
      }

      let notes = null;
      if (opts.notes) {
        try {
          notes = JSON.parse(opts.notes);
        } catch (err) {
          throw new Error(`Invalid --notes JSON: ${err?.message || err}`);
        }
      }

      const link = await createPaymentLink({
        keyId: rp.keyId,
        keySecret: rp.keySecret,
        amountInr: opts.amount,
        description: opts.desc,
        callbackUrl: opts.callbackUrl,
        customer: {
          name: opts.name || undefined,
          email: opts.email || undefined,
          contact: String(opts.to)
        },
        notes: notes || { client, createdBy: "waba-agent" }
      });

      const ctx = await createAgentContext({ client, memoryEnabled: memory !== false });
      const url = link.short_url || "";
      if (!url) throw new Error("Razorpay payment link missing short_url.");
      const body = `Payment link for INR ${opts.amount}:\n${url}\n\n${opts.desc}`;

      logger.warn("High risk: this will send an outbound WhatsApp message (per-message billed).");
      if (!opts.yes) {
        const ok = await askYesNo(`Send payment link to ${opts.to}?`, { defaultYes: false });
        if (!ok) {
          logger.warn("Cancelled.");
          return;
        }
      }

      const res = await ctx.registry.get("message.send_text").execute(ctx, { to: opts.to, body, category: "utility" });

      await ctx.appendMemory(client, { type: "payment_link_sent", to: opts.to, amountInr: opts.amount, link, ts: new Date().toISOString() });

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, link, whatsapp: res }, null, 2));
        return;
      }
      logger.ok("Payment link created + sent.");
      logger.info(`link_id=${link.id} status=${link.status}`);
    });

  p.command("status")
    .description("show payment providers configured for a client (redacted)")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const clientCfg = (await getClientConfig(client)) || {};
      const rp = clientCfg.payments?.razorpay || {};
      const out = {
        client,
        razorpay: rp.keyId ? "***set***" : null,
        webhookSecret: rp.webhookSecret ? "***set***" : null
      };
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, out }, null, 2));
        return;
      }
      logger.info(JSON.stringify(out, null, 2));
    });

  p.command("webhook-handler")
    .description("start local Razorpay webhook handler (verifies signature; logs + optional CRM push)")
    .argument("<action>", "start")
    .option("--host <host>", "bind host", "127.0.0.1")
    .option("--port <n>", "port", (v) => Number(v), 3002)
    .option("--path <path>", "path", "/payments/razorpay/webhook")
    .option("--client <name>", "client name (default: active client)")
    .action(async (action, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json, memory } = root.opts();
      if (json) throw new Error("--json not supported for long-running server.");
      if (action !== "start") throw new Error("Use: waba payments webhook-handler start");

      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const clientCfg = (await getClientConfig(client)) || {};
      const rp = clientCfg.payments?.razorpay;
      if (!rp?.webhookSecret) {
        logger.warn("Missing Razorpay webhook secret. Pass --webhook-secret in `payments enable razorpay` for signature verification.");
      }

      const ctx = await createAgentContext({ client, memoryEnabled: memory !== false });

      const app = express();
      app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

      app.use(
        opts.path,
        bodyParser.raw({
          type: "*/*",
          limit: "2mb"
        })
      );

      app.post(opts.path, async (req, res) => {
        try {
          const sig = req.headers["x-razorpay-signature"];
          const raw = req.body;
          if (rp?.webhookSecret) {
            const ok = verifyRazorpayWebhook({ secret: rp.webhookSecret, rawBody: raw, signature: sig });
            if (!ok) {
              res.status(401).send("Bad signature");
              return;
            }
          }
          let payload;
          try {
            payload = JSON.parse(raw.toString("utf8"));
          } catch {
            res.status(400).send("Invalid JSON");
            return;
          }

          res.status(200).send("OK");

          const event = payload.event || "unknown";
          await ctx.appendMemory(client, { type: "payment_webhook", event, payload, ts: new Date().toISOString() });
          logger.info(`razorpay webhook: ${event}`);

          // Optional CRM push
          if (hasAnyCrm(clientCfg.integrations)) {
            const lead = { event: "payment_event", client, ts: new Date().toISOString(), paymentEvent: event, payload };
            const out = await pushLeadToCrm({ client, clientCfg, lead });
            await ctx.appendMemory(client, { type: "crm_push", ok: out.ok, results: out.results, ts: new Date().toISOString(), event: "payment_event" });
          }
        } catch (err) {
          logger.error(err?.stack || String(err));
          try {
            if (!res.headersSent) res.status(500).send("Server error");
          } catch {}
        }
      });

      await new Promise((resolve) => app.listen(opts.port, opts.host, () => resolve()));
      logger.ok(`Razorpay webhook handler: http://${opts.host}:${opts.port}${opts.path}`);
    });
}

module.exports = { registerPaymentsCommands };
