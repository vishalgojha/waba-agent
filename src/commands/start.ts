// @ts-nocheck
const crypto = require("crypto");

const { getConfig, setConfig } = require("../lib/config");
const { addOrUpdateClient } = require("../lib/clients");
const { logger } = require("../lib/logger");
const { safeClientName } = require("../lib/creds");
const { createWizardPrompter } = require("../lib/wizard/prompter");
const { WizardCancelledError } = require("../lib/wizard/prompts");
const { resolveAiProviderConfig } = require("../lib/ai/openai");
const { ChatSession } = require("../lib/chat/session");
const { startGatewayServer } = require("../server/gateway");
const { runHatchCommand } = require("./hatch");
const { runGuidedDemo } = require("./demo");

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_OLLAMA_MODEL = "deepseek-coder-v2:16b";

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function isDigits(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function metaDashboardUrl(appId) {
  const id = String(appId || "").trim();
  if (!id) return "https://developers.facebook.com/apps/";
  return `https://developers.facebook.com/apps/${id}/`;
}

function summarizeReadiness(cfg = {}) {
  const runtime = resolveAiProviderConfig(cfg);
  const metaReady = !!(cfg.token && cfg.phoneNumberId && cfg.wabaId);
  const webhookReady = !!cfg.webhookVerifyToken;
  const aiReady = !!(runtime.apiKey && runtime.model);
  const aiMode = runtime.localFallback === "ollama" ? "ollama(local)" : (runtime.provider || "none");

  return {
    metaReady,
    webhookReady,
    aiReady,
    aiMode,
    missing: [
      ...(metaReady ? [] : ["meta_credentials"]),
      ...(webhookReady ? [] : ["webhook_verify_token"]),
      ...(aiReady ? [] : ["ai_provider"])
    ]
  };
}

async function askText(prompter, message, { optional = false, validate } = {}) {
  while (true) {
    const value = String(await prompter.text({ message })).trim();
    if (!value && optional) return null;
    if (!value) {
      logger.warn("This field cannot be empty.");
      continue;
    }
    if (typeof validate === "function") {
      const err = validate(value);
      if (err) {
        logger.warn(err);
        continue;
      }
    }
    return value;
  }
}

async function setupMetaCredentials(prompter, { client, appId }) {
  const hasNow = await prompter.confirm({
    message: "Do you have Meta token, phone number ID, and WABA ID right now?",
    initialValue: false
  });
  if (!hasNow) {
    logger.info("No problem. Use these Meta screens when ready:");
    logger.info(`App dashboard: ${metaDashboardUrl(appId)}`);
    logger.info("WhatsApp API Setup: Products -> WhatsApp -> API Setup");
    logger.info("Business settings (system user token): https://business.facebook.com/settings");
    logger.info("We need: WABA_TOKEN, WABA_PHONE_ID, WABA_BUSINESS_ID");
    return false;
  }

  const token = await askText(prompter, "Paste access token:", { optional: false });
  const phoneId = await askText(prompter, "Phone number ID (digits only):", {
    optional: false,
    validate: (v) => (isDigits(v) ? "" : "Phone number ID should contain only digits.")
  });
  const businessId = await askText(prompter, "WABA (WhatsApp Business Account) ID (digits only):", {
    optional: false,
    validate: (v) => (isDigits(v) ? "" : "WABA ID should contain only digits.")
  });

  await addOrUpdateClient(
    client,
    {
      token,
      phoneNumberId: phoneId,
      wabaId: businessId
    },
    { makeActive: true }
  );
  logger.ok(`Saved Meta credentials for '${client}'.`);
  return true;
}

function providerFields(provider) {
  if (provider === "openai") {
    return { keyField: "openaiApiKey", modelField: "openaiModel", baseUrlField: "openaiBaseUrl" };
  }
  if (provider === "anthropic") {
    return { keyField: "anthropicApiKey", modelField: "anthropicModel", baseUrlField: "anthropicBaseUrl" };
  }
  if (provider === "xai") {
    return { keyField: "xaiApiKey", modelField: "xaiModel", baseUrlField: "xaiBaseUrl" };
  }
  if (provider === "openrouter") {
    return { keyField: "openrouterApiKey", modelField: "openrouterModel", baseUrlField: "openrouterBaseUrl" };
  }
  return { keyField: null, modelField: null, baseUrlField: null };
}

async function setupAiProvider(prompter, cfg) {
  const runtime = resolveAiProviderConfig(cfg);
  const alreadyConfigured = !!(runtime.apiKey && runtime.model);
  if (alreadyConfigured) {
    const keep = await prompter.confirm({
      message: `AI is already configured (${runtime.provider || "openai"} / ${runtime.model}). Keep it?`,
      initialValue: true
    });
    if (keep) return;
  }

  const choice = await prompter.select({
    message: "Choose AI mode",
    options: [
      { value: "ollama", label: "Local Ollama (recommended)", hint: "No paid API key required" },
      { value: "openai", label: "OpenAI", hint: "Cloud hosted" },
      { value: "anthropic", label: "Anthropic", hint: "Cloud hosted" },
      { value: "xai", label: "xAI", hint: "Cloud hosted" },
      { value: "openrouter", label: "OpenRouter", hint: "Cloud hosted multi-model" },
      { value: "later", label: "Skip for now", hint: "You can set this later" }
    ],
    initialValue: "ollama"
  });

  if (choice === "later") {
    logger.info("Skipped AI setup.");
    return;
  }

  if (choice === "ollama") {
    await setConfig({
      aiProvider: "ollama",
      openaiBaseUrl: DEFAULT_OLLAMA_BASE_URL,
      openaiModel: process.env.WABA_OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL
    });
    logger.ok("Configured local Ollama defaults.");
    logger.info("If needed, pull a model: ollama pull deepseek-coder-v2:16b");
    return;
  }

  const fields = providerFields(choice);
  const patch = { aiProvider: choice };
  const apiKey = await askText(prompter, `API key for ${choice} (leave blank to skip):`, { optional: true });
  const model = await askText(prompter, `Model for ${choice} (optional):`, { optional: true });
  const baseUrl = await askText(prompter, `Base URL override for ${choice} (optional):`, { optional: true });

  if (fields.keyField && apiKey) patch[fields.keyField] = apiKey;
  if (fields.modelField && model) patch[fields.modelField] = model;
  if (fields.baseUrlField && baseUrl) patch[fields.baseUrlField] = baseUrl;

  await setConfig(patch);
  logger.ok(`Saved AI provider config: ${choice}.`);
  if (!apiKey) {
    logger.warn(`API key not provided for ${choice}. Update later before cloud AI calls.`);
  }
}

async function ensureWebhookVerifyToken(cfg) {
  if (cfg.webhookVerifyToken) return cfg.webhookVerifyToken;
  const verifyToken = base64url(crypto.randomBytes(24));
  await setConfig({ webhookVerifyToken: verifyToken });
  return verifyToken;
}

async function launchExperience(prompter, { client, lang, rootProgram, skipLaunch }) {
  if (skipLaunch) {
    logger.info("Setup complete. Skipped launch (--skip-launch).");
    return;
  }

  const action = await prompter.select({
    message: "What do you want to open now?",
    options: [
      { value: "hatch", label: "Agentic terminal (hatch)", hint: "Approvals + actions + sessions" },
      { value: "gateway", label: "Web dashboard", hint: "Browser UI at localhost" },
      { value: "chat", label: "Simple terminal chat", hint: "Conversation only" },
      { value: "none", label: "Nothing now", hint: "Just finish setup" }
    ],
    initialValue: "hatch"
  });

  if (action === "none") {
    logger.info(`Run later: waba hatch --client ${client} --start-gateway`);
    return;
  }

  if (action === "chat") {
    const session = new ChatSession({ client, language: lang === "hi" ? "hi" : "en" });
    await session.start();
    return;
  }

  if (action === "gateway") {
    logger.info("Starting gateway at http://127.0.0.1:3010");
    await startGatewayServer({
      host: "127.0.0.1",
      port: 3010,
      client,
      language: lang === "hi" ? "hi" : "en"
    });
    return;
  }

  await runHatchCommand(
    {
      host: "127.0.0.1",
      port: 3010,
      client,
      lang: lang === "hi" ? "hi" : "en",
      startGateway: true
    },
    rootProgram
  );
}

function registerStartCommands(program) {
  const runStartFlow = async (opts, root) => {
    if (root.opts().json) throw new Error("--json is not supported for interactive start.");
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error("waba start requires an interactive terminal.");
    }

    const prompter = createWizardPrompter();
    try {
      const cfg = await getConfig();
      const client = safeClientName(opts.client || cfg.activeClient || "default");
      const lang = opts.lang === "hi" ? "hi" : "en";
      const status = summarizeReadiness(cfg);

      logger.info(`Client: ${client}`);
      logger.info(`Meta credentials: ${status.metaReady ? "ready" : "missing"}`);
      logger.info(`AI mode: ${status.aiMode}${status.aiReady ? "" : " (missing key/model)"}`);
      logger.info(`Webhook verify token: ${status.webhookReady ? "set" : "missing"}`);
      if (!status.metaReady || !status.webhookReady) {
        logger.info("What to run first:");
        logger.info("1. waba check");
        logger.info("2. waba fix");
        logger.info("3. waba go");
      }

      const wantsMetaSetup = !status.metaReady
        ? await prompter.confirm({ message: "Set up Meta credentials now?", initialValue: true })
        : await prompter.confirm({ message: "Update existing Meta credentials?", initialValue: false });
      if (wantsMetaSetup) {
        await setupMetaCredentials(prompter, { client, appId: opts.appId });
      }

      await setupAiProvider(prompter, await getConfig());

      const verifyToken = await ensureWebhookVerifyToken(await getConfig());
      logger.ok("Setup checkpoint complete.");
      logger.info(`Webhook verify token: ${verifyToken}`);

      await launchExperience(prompter, {
        client,
        lang,
        rootProgram: root,
        skipLaunch: !!opts.skipLaunch
      });
    } catch (err) {
      if (err instanceof WizardCancelledError) {
        logger.warn("Start flow cancelled.");
        return;
      }
      throw err;
    }
  };

  program
    .command("start")
    .alias("hi")
    .description("friendly non-technical setup + launch assistant")
    .option("--client <name>", "client context (default: active client or 'default')")
    .option("--lang <lang>", "assistant language en|hi", "en")
    .option("--app-id <id>", "Meta app id for direct dashboard link")
    .option("--skip-launch", "only configure setup and exit", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent || program;
      await runStartFlow(opts, root);
    });

  program
    .command("go")
    .description("quick check, then auto-open start assistant when ready")
    .action(async (_opts, cmd) => {
      const root = cmd.parent || program;
      const out = await runGuidedDemo({
        autoFix: true,
        scopeCheckMode: "best-effort"
      });

      if (out.ok) {
        logger.ok("Environment looks ready. Opening start assistant...");
        await runStartFlow({}, root);
        return;
      }

      logger.warn("Not ready yet. Do these next:");
      for (const step of out.next.steps.slice(0, 3)) {
        logger.info(`${step.id}. ${step.command}`);
      }
      process.exitCode = 1;
    });
}

module.exports = {
  registerStartCommands,
  summarizeReadiness,
  metaDashboardUrl,
  isDigits
};
