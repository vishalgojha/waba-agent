const crypto = require("crypto");

const { getConfig, setConfig } = require("../lib/config");
const { addOrUpdateClient } = require("../lib/clients");
const { createAgentContext } = require("../lib/agent/agent");
const { askInput, askYesNo } = require("../lib/prompt");
const { logger } = require("../lib/logger");
const { ensurePresetFlow } = require("../lib/flow-store");
const { setClientConfig, getClientConfig } = require("../lib/client-config");
const { saveDraft, loadDraft } = require("../lib/template-drafts");
const { safeName } = require("../lib/memory");
const { startWebhookServer } = require("../server/webhook");

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function defaultIntentReplies(industry) {
  const i = String(industry || "").trim().toLowerCase();
  if (i === "real-estate" || i === "realestate" || i === "real_estate") {
    return {
      greeting: "Hi! Welcome. Share your name + which area you are looking in?",
      price_inquiry: "Sure. Please share the location/area and your budget range (example: 50L-80L).",
      booking_request: "Sure. What date/time works for you? Share preferred slot and location.",
      order_intent: "Great. Please share the exact requirement and location so we can confirm availability and price.",
      fallback: "Thanks for messaging. Please share your name, location, and requirement."
    };
  }
  if (i === "salon") {
    return {
      greeting: "Hi! Welcome to our salon. What service do you need (haircut/facial/cleanup) and preferred time?",
      price_inquiry: "Sure. Which service are you asking for? I can share the latest price list.",
      booking_request: "Sure. Please share preferred date/time and service. We will confirm your slot.",
      order_intent: "Please share what you want to buy and your delivery area/pincode.",
      fallback: "Thanks for messaging. Tell us what you need and your preferred time."
    };
  }
  if (i === "clinic" || i === "doctor") {
    return {
      greeting: "Hi! Welcome. Please share patient name and the issue (brief).",
      price_inquiry: "Sure. Please share the service (consultation/test) and we will confirm charges.",
      booking_request: "Sure. Please share preferred date/time and patient name. We will confirm appointment.",
      order_intent: "Please share what you want to purchase (medicine/test package) and details.",
      fallback: "Thanks for messaging. Please share your name and what you need help with."
    };
  }
  if (i === "ecommerce" || i === "e-commerce" || i === "shop") {
    return {
      greeting: "Hi! Welcome. What product are you looking for?",
      price_inquiry: "Sure. Please share product name/model and quantity.",
      booking_request: "Sure. Please share preferred delivery date/time and address area/pincode.",
      order_intent: "Great. Share product + quantity + pincode and we will confirm the order.",
      fallback: "Thanks for messaging. Please share product, quantity, and your pincode."
    };
  }
  return {
    greeting: "Hi! Welcome. How can we help you today?",
    price_inquiry: "Sure. Please share what you are looking for and your location.",
    booking_request: "Sure. Please share preferred date/time and details.",
    order_intent: "Great. Please share product/service details and quantity.",
    fallback: "Thanks for messaging. Please share your requirement and location."
  };
}

async function askNonEmpty(question, { optional = false } = {}) {
  // Simple helper around askInput that allows blank values.
  // Note: tokens are not masked; avoid screen-sharing during onboarding.
  const v = (await askInput(question)).trim();
  if (!v && !optional) return null;
  return v || null;
}

function registerOnboardCommands(program) {
  program
    .command("onboard")
    .description("client onboarding wizard (prints next steps and writes safe local config)")
    .option("--client <name>", "client name", "default")
    .option("--wizard", "run the full interactive wizard (drafts + flow + optional webhook start)", false)
    .option("--industry <real-estate|salon|clinic|ecommerce|custom>", "industry preset for replies", "custom")
    .option("--start-webhook", "start webhook server at the end (blocks; Ctrl+C to stop)", false)
    .option("--ngrok", "start an ngrok tunnel (for local testing)", false)
    .option("--port <n>", "webhook port (when using --start-webhook)", (v) => Number(v), 3000)
    .option("--path <path>", "webhook path (when using --start-webhook)", "/webhook")
    .option("--verbose", "verbose webhook logs (PII redacted)", false)
    .option("--llm", "enable LLM classification/suggestions (requires any configured AI provider key)", false)
    .option("--allow-outbound", "allow outbound replies from webhook flow (still prompts for confirmation)", false)
    .option("--non-interactive", "do not prompt; only print required steps", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent || program;
      const { json, memory } = root.opts();
      if (json) throw new Error("--json not supported for onboarding wizard.");

      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      logger.info(`Onboarding client: ${client}`);
      logger.warn("Security: onboarding prompts are not masked. Avoid screen-sharing while entering tokens/secrets.");
      logger.info("This wizard does NOT send outbound WhatsApp messages. Webhook auto-replies require `waba webhook start --allow-outbound`.");

      let token = null;
      let phoneId = null;
      let businessId = null;
      let publicUrl = null;

      const interactive = !!opts.wizard && !opts.nonInteractive;
      if (interactive) {
        token = await askNonEmpty("Permanent access token (optional; leave blank to skip):", { optional: true });
        phoneId = await askNonEmpty("Phone number ID (optional; leave blank to skip):", { optional: true });
        businessId = await askNonEmpty("WABA ID (business account id) (optional; leave blank to skip):", { optional: true });
        publicUrl = await askNonEmpty("Public URL for webhooks (optional). Example: https://xxxx.ngrok-free.app", { optional: true });
      } else if (!opts.nonInteractive) {
        // Backward-compatible: old behavior (interactive by default) when neither --wizard nor --non-interactive is passed.
        token = await askNonEmpty("Permanent access token (optional; leave blank to skip):", { optional: true });
        phoneId = await askNonEmpty("Phone number ID (optional; leave blank to skip):", { optional: true });
        businessId = await askNonEmpty("WABA ID (business account id) (optional; leave blank to skip):", { optional: true });
        publicUrl = await askNonEmpty("Public URL for webhooks (optional). Example: https://xxxx.ngrok-free.app", { optional: true });
      }

      if (token && phoneId && businessId) {
        await addOrUpdateClient(client, { token, phoneNumberId: phoneId, wabaId: businessId }, { makeActive: true });
        logger.ok("Saved client credentials (active client updated).");
      } else {
        logger.warn("Credentials not captured. You can set them later:");
        logger.info(`waba clients add ${client} --token <TOKEN> --phone-id <PHONE_ID> --business-id <WABA_ID> --switch`);
      }

      // Ensure per-client scaffold exists.
      const ctx = await createAgentContext({ client, memoryEnabled: memory !== false });
      try {
        const tool = ctx.registry.get("client.init");
        if (tool) await tool.execute(ctx, { client });
        logger.ok("Created/verified client config scaffold (~/.waba/context/<client>/client.json).");
      } catch (err) {
        logger.warn(`client.init failed: ${err?.message || err}`);
      }

      // Verify token for webhooks.
      let verifyToken = cfg.webhookVerifyToken;
      if (!verifyToken) {
        verifyToken = base64url(crypto.randomBytes(24));
        await setConfig({ webhookVerifyToken: verifyToken });
        logger.ok("Generated webhook verify token and saved to config.");
      }

      // Client defaults (sellable): intent replies + optional welcome template + staff notify number + flow routing.
      const prevClientCfg = (await getClientConfig(client)) || {};
      const replies = defaultIntentReplies(opts.industry);
      await setClientConfig(client, {
        industry: opts.industry,
        intentReplies: {
          greeting: prevClientCfg?.intentReplies?.greeting || replies.greeting,
          price_inquiry: prevClientCfg?.intentReplies?.price_inquiry || replies.price_inquiry,
          booking_request: prevClientCfg?.intentReplies?.booking_request || replies.booking_request,
          order_intent: prevClientCfg?.intentReplies?.order_intent || replies.order_intent,
          fallback: prevClientCfg?.intentReplies?.fallback || replies.fallback
        },
        flows: {
          active: prevClientCfg?.flows?.active || "lead-qualification",
          intentMap: prevClientCfg?.flows?.intentMap || {
            booking_request: "lead-qualification",
            price_inquiry: "lead-qualification",
            order_intent: "lead-qualification"
          }
        }
      });
      logger.ok("Saved client defaults (intent replies + basic flow routing).");

      if (interactive) {
        const notify = await askNonEmpty("Staff notify number for handoff (optional; E.164 without +):", { optional: true });
        if (notify) {
          await setClientConfig(client, { handoff: { notifyNumber: notify } });
          logger.ok("Saved staff notify number in client config.");
        }

        const welcomeTemplate = await askNonEmpty("Approved welcome template name (optional; used when session is closed):", { optional: true });
        if (welcomeTemplate) {
          const lang = (await askNonEmpty("Welcome template language (default: en):", { optional: true })) || "en";
          await setClientConfig(client, { templates: { welcome: { name: welcomeTemplate, language: lang } } });
          logger.ok("Saved welcome template mapping in client config.");
        }
      }

      // Ensure preset flow exists (premium demo).
      const flowName = prevClientCfg?.flows?.active || "lead-qualification";
      const ensured = await ensurePresetFlow(client, flowName);
      logger.ok(`${ensured.created ? "Created" : "Found"} preset flow: ${flowName}`);

      // Generate local template drafts (fast client customization).
      if (interactive) {
        const wantsDrafts = await askYesNo("Generate local template drafts for this client (recommended)?", { defaultYes: true });
        if (wantsDrafts) {
          const prefix = safeName(client).slice(0, 24) || "client";
          const welcomeName = `${prefix}_welcome`;
          const followupName = `${prefix}_followup`;

          const existingWelcome = await loadDraft(client, welcomeName);
          if (!existingWelcome) {
            await saveDraft(client, {
              name: welcomeName,
              language: "en_US",
              category: "UTILITY",
              components: [
                {
                  type: "BODY",
                  text: "Hi {{1}}, thanks for contacting {{2}}. How can we help you today?"
                },
                { type: "FOOTER", text: "Reply STOP to opt out." }
              ]
            });
          }

          const existingFollowup = await loadDraft(client, followupName);
          if (!existingFollowup) {
            await saveDraft(client, {
              name: followupName,
              language: "en_US",
              category: "MARKETING",
              components: [
                {
                  type: "BODY",
                  text: "Hi {{1}}, quick follow up from {{2}}. Would you like to book an appointment/call? Reply 1 for Yes, 2 for Later."
                },
                { type: "FOOTER", text: "Reply STOP to opt out." }
              ]
            });
          }

          logger.ok("Saved local template drafts under ~/.waba/context/<client>/templates/");
          logger.info(`Draft names: ${welcomeName}, ${followupName}`);
          logger.info("Next: edit drafts if needed, then submit:");
          logger.info(`waba template submit-for-approval --client ${client} --name ${welcomeName} --category UTILITY --language en_US`);
          logger.info(`waba template submit-for-approval --client ${client} --name ${followupName} --category MARKETING --language en_US`);
        }
      }

      if (publicUrl) {
        const normalized = String(publicUrl).replace(/\/+$/, "");
        logger.info("Meta webhook setup values:");
        logger.info(`Callback URL: ${normalized}/webhook`);
        logger.info(`Verify token: ${verifyToken}`);
      } else {
        logger.info("Webhook setup next step:");
        logger.info("waba webhook setup --url <PUBLIC_URL>");
      }

      logger.info("Start receiver:");
      logger.info(`waba webhook start --client ${client} --port 3000 --ngrok --verbose`);

      const wantsSheets = opts.nonInteractive ? false : await askYesNo("Configure Google Sheets lead sync now?", { defaultYes: false });
      if (wantsSheets) {
        logger.info("1) waba integrate google-sheets --print-apps-script");
        logger.info("2) Deploy as Web App, then:");
        logger.info(`   waba integrate google-sheets --client ${client} --apps-script-url "<URL>" --test`);
        logger.info(`   waba sync leads --to sheets --client ${client} --days 30`);
      }

      const wantsStart = opts.startWebhook || (interactive ? await askYesNo("Start webhook server now (Ctrl+C to stop)?", { defaultYes: false }) : false);
      if (wantsStart) {
        logger.info("Starting webhook server...");
        const out = await startWebhookServer({
          host: "127.0.0.1",
          port: opts.port,
          pathName: opts.path,
          verifyToken,
          appSecret: cfg.appSecret,
          client,
          verbose: !!opts.verbose,
          allowOutbound: !!opts.allowOutbound,
          memoryEnabled: memory !== false,
          enableNgrok: !!opts.ngrok,
          llm: !!opts.llm
        });

        if (out.publicUrl) {
          await setConfig({ lastPublicWebhookUrl: out.publicUrl, lastOnboardedClient: client, lastOnboardedAt: new Date().toISOString() });
          logger.ok(`Public URL saved to config: ${out.publicUrl}`);
          logger.info("Meta webhook setup values:");
          logger.info(`Callback URL: ${out.publicUrl.replace(/\/+$/, "")}${opts.path}`);
          logger.info(`Verify token: ${verifyToken}`);
        }
      }
    });
}

module.exports = { registerOnboardCommands };
