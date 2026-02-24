// @ts-nocheck
const crypto = require("crypto");

const { getConfig, setConfig } = require("../lib/config");
const { addOrUpdateClient } = require("../lib/clients");
const { createAgentContext } = require("../lib/agent/agent");
const { logger } = require("../lib/logger");
const { ensurePresetFlow } = require("../lib/flow-store");
const { setClientConfig, getClientConfig } = require("../lib/client-config");
const { saveDraft, loadDraft } = require("../lib/template-drafts");
const { safeName } = require("../lib/memory");
const { startWebhookServer } = require("../server/webhook");
const { createWizardPrompter } = require("../lib/wizard/prompter");
const { WizardCancelledError } = require("../lib/wizard/prompts");

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

function normalizeAiProvider(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return null;
  if (["openai", "anthropic", "xai", "openrouter", "ollama"].includes(v)) return v;
  return null;
}

function aiConfigFields(provider) {
  switch (provider) {
    case "openai":
      return { keyField: "openaiApiKey", modelField: "openaiModel", baseUrlField: "openaiBaseUrl" };
    case "anthropic":
      return { keyField: "anthropicApiKey", modelField: "anthropicModel", baseUrlField: "anthropicBaseUrl" };
    case "xai":
      return { keyField: "xaiApiKey", modelField: "xaiModel", baseUrlField: "xaiBaseUrl" };
    case "openrouter":
      return { keyField: "openrouterApiKey", modelField: "openrouterModel", baseUrlField: "openrouterBaseUrl" };
    case "ollama":
      return { keyField: null, modelField: "openaiModel", baseUrlField: "openaiBaseUrl" };
    default:
      return { keyField: null, modelField: null, baseUrlField: null };
  }
}

function parseTemplateParamsInput(raw) {
  const input = String(raw || "").trim();
  if (!input) return [];
  if (input.startsWith("[")) {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed)) throw new Error("Template params JSON must be an array.");
    return parsed;
  }
  return input.split(",").map((x) => x.trim()).filter(Boolean);
}

async function askNonEmpty(prompter, question, { optional = false } = {}) {
  // Simple helper around askInput that allows blank values.
  // Note: tokens are not masked; avoid screen-sharing during onboarding.
  const v = (await prompter.text({ message: question })).trim();
  if (!v && !optional) return null;
  return v || null;
}

async function runHatchPrompt(prompter, { client }) {
  const hatchChoice = await prompter.select({
    message: "How do you want to hatch your bot?",
    options: [
      { value: "tui", label: "Hatch in TUI (recommended)", hint: "Terminal-first flow for quick setup" },
      { value: "web", label: "Open Gateway Web UI", hint: "Browser-based approvals and dashboards" },
      { value: "later", label: "Do this later", hint: "Print next steps only" }
    ],
    initialValue: "tui"
  });

  if (hatchChoice === "tui") {
    await prompter.note(
      [
        "Hatch TUI ready.",
        "Run now: waba hatch --client " + client + " --start-gateway",
        "Fallback web UI: waba gw --client " + client + " --port 3010"
      ].join("\n"),
      "Hatch"
    );
    return;
  }

  if (hatchChoice === "web") {
    await prompter.note(
      [
        "Gateway hatch ready.",
        "Run now: waba gw --client " + client + " --port 3010",
        "Then open: http://127.0.0.1:3010/"
      ].join("\n"),
      "Hatch"
    );
    return;
  }

  await prompter.note(
    [
      "You can hatch anytime with either flow:",
      "waba hatch --client " + client + " --start-gateway",
      "waba gw --client " + client + " --port 3010",
      "waba chat --client " + client + " (quick terminal chat)"
    ].join("\n"),
    "Hatch"
  );
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
      const prompter = createWizardPrompter();

      try {

      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      logger.info(`Onboarding client: ${client}`);
      logger.warn("Security: onboarding prompts are not masked. Avoid screen-sharing while entering tokens/secrets.");
      logger.info("This wizard does NOT send outbound WhatsApp messages. Webhook auto-replies require `waba webhook start --allow-outbound`.");

      let token = null;
      let phoneId = null;
      let businessId = null;
      let publicUrl = null;
      let aiProvider = null;
      let aiApiKey = null;
      let aiModel = null;
      let aiBaseUrl = null;

      const interactive = !!opts.wizard && !opts.nonInteractive;
      if (!opts.nonInteractive) {
        token = await askNonEmpty(prompter, "Permanent access token (optional; leave blank to skip):", { optional: true });
        phoneId = await askNonEmpty(prompter, "Phone number ID (optional; leave blank to skip):", { optional: true });
        businessId = await askNonEmpty(prompter, "WABA ID (business account id) (optional; leave blank to skip):", { optional: true });
        publicUrl = await askNonEmpty(prompter, "Public URL for webhooks (optional). Example: https://xxxx.ngrok-free.app", { optional: true });

        const wantsAiSetup = await prompter.confirm({
          message: "Configure AI provider now (recommended for chat/gateway)?",
          initialValue: true
        });
        if (wantsAiSetup) {
          const pickedProvider = await askNonEmpty(prompter, "AI provider [openai|anthropic|xai|openrouter|ollama] (default: openai):", { optional: true });
          aiProvider = normalizeAiProvider(pickedProvider || "openai");
          if (!aiProvider) {
            logger.warn("Unsupported AI provider input. Skipping AI setup.");
          } else {
            const providerMsg = aiProvider === "ollama" ? "Ollama selected (no hosted API key required)." : `Using provider: ${aiProvider}`;
            logger.info(providerMsg);
            if (aiProvider !== "ollama") {
              aiApiKey = await askNonEmpty(prompter, `API key for ${aiProvider} (optional; leave blank to skip):`, { optional: true });
            }
            aiModel = await askNonEmpty(prompter, `Model override for ${aiProvider} (optional; leave blank for defaults):`, { optional: true });
            aiBaseUrl = await askNonEmpty(prompter, `Base URL override for ${aiProvider} (optional; leave blank for defaults):`, { optional: true });
          }
        }
      }

      if (token && phoneId && businessId) {
        await addOrUpdateClient(client, { token, phoneNumberId: phoneId, wabaId: businessId }, { makeActive: true });
        logger.ok("Saved client credentials (active client updated).");
      } else {
        logger.warn("Credentials not captured. You can set them later:");
        logger.info(`waba clients add ${client} --token <TOKEN> --phone-id <PHONE_ID> --business-id <WABA_ID> --switch`);
      }

      if (aiProvider) {
        const fields = aiConfigFields(aiProvider);
        const patch = { aiProvider };
        if (fields.keyField && aiApiKey) patch[fields.keyField] = aiApiKey;
        if (fields.modelField && aiModel) patch[fields.modelField] = aiModel;
        if (fields.baseUrlField && aiBaseUrl) patch[fields.baseUrlField] = aiBaseUrl;
        await setConfig(patch);
        logger.ok(`Saved AI provider config (${aiProvider}).`);
        if (fields.keyField && !aiApiKey) {
          logger.warn(`API key not captured for ${aiProvider}. You can set it later via env var or config.`);
        }
      } else if (!opts.nonInteractive) {
        logger.warn("AI provider not configured in onboarding. Set WABA_AI_PROVIDER + provider key later to enable LLM features.");
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
        const notify = await askNonEmpty(prompter, "Staff notify number for handoff (optional; E.164 without +):", { optional: true });
        if (notify) {
          await setClientConfig(client, { handoff: { notifyNumber: notify } });
          logger.ok("Saved staff notify number in client config.");
        }

        const welcomeTemplate = await askNonEmpty(prompter, "Approved welcome template name (optional; used when session is closed):", { optional: true });
        if (welcomeTemplate) {
          const lang = (await askNonEmpty(prompter, "Welcome template language (default: en):", { optional: true })) || "en";
          await setClientConfig(client, { templates: { welcome: { name: welcomeTemplate, language: lang } } });
          logger.ok("Saved welcome template mapping in client config.");
        }

        const wantsVerificationProfile = await prompter.confirm({
          message: "Capture staging verification target details now?",
          initialValue: true
        });
        if (wantsVerificationProfile) {
          const testRecipient = await askNonEmpty(prompter, "Staging test recipient number (optional; E.164 without +):", { optional: true });
          const testTemplate = await askNonEmpty(prompter, "Approved template name for staging send test (optional):", { optional: true });
          let templateLanguage = null;
          let templateParams = [];
          if (testTemplate) {
            templateLanguage = (await askNonEmpty(prompter, "Template language for staging test (default: en):", { optional: true })) || "en";
            const paramsInput = await askNonEmpty(prompter, "Sample template params (optional; JSON array or comma-separated):", { optional: true });
            if (paramsInput) {
              try {
                templateParams = parseTemplateParamsInput(paramsInput);
              } catch (err) {
                logger.warn(`Could not parse sample params: ${err?.message || err}`);
                templateParams = [];
              }
            }
          }
          if (testRecipient || testTemplate) {
            const staging = {};
            if (testRecipient) staging.testRecipient = testRecipient;
            if (testTemplate) staging.template = { name: testTemplate, language: templateLanguage || "en", params: templateParams };
            await setClientConfig(client, { verification: { staging } });
            logger.ok("Saved staging verification profile in client config.");
          }
        }
      }

      // Ensure preset flow exists (premium demo).
      const flowName = prevClientCfg?.flows?.active || "lead-qualification";
      const ensured = await ensurePresetFlow(client, flowName);
      logger.ok(`${ensured.created ? "Created" : "Found"} preset flow: ${flowName}`);

      // Generate local template drafts (fast client customization).
      if (interactive) {
        const wantsDrafts = await prompter.confirm({
          message: "Generate local template drafts for this client (recommended)?",
          initialValue: true
        });
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

      const wantsSheets = opts.nonInteractive
        ? false
        : await prompter.confirm({ message: "Configure Google Sheets lead sync now?", initialValue: false });
      if (wantsSheets) {
        logger.info("1) waba integrate google-sheets --print-apps-script");
        logger.info("2) Deploy as Web App, then:");
        logger.info(`   waba integrate google-sheets --client ${client} --apps-script-url "<URL>" --test`);
        logger.info(`   waba sync leads --to sheets --client ${client} --days 30`);
      }

      const wantsStart = opts.startWebhook
        || (interactive
          ? await prompter.confirm({
            message: "Start webhook server now (Ctrl+C to stop)?",
            initialValue: false
          })
          : false);
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

      if (interactive) {
        await runHatchPrompt(prompter, { client });
      }
      } catch (err) {
        if (err instanceof WizardCancelledError) {
          logger.warn("Onboarding cancelled.");
          return;
        }
        throw err;
      }
    });
}

module.exports = { registerOnboardCommands };
