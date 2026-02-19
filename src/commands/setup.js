const crypto = require("crypto");
const fs = require("fs-extra");
const path = require("path");
const { pathToFileURL } = require("url");

const { getConfig, setConfig } = require("../lib/config");
const { addOrUpdateClient, safeClientName, switchClient } = require("../lib/clients");
const { buildReadiness } = require("../lib/readiness");
const { logger } = require("../lib/logger");

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_OLLAMA_MODEL = "deepseek-coder-v2:16b";

async function loadTsConfigBridge() {
  const root = path.resolve(__dirname, "..", "..");
  const configJs = path.join(root, ".tmp-ts", "src-ts", "config.js");
  if (!(await fs.pathExists(configJs))) return null;
  const mod = await import(pathToFileURL(configJs).href);
  if (!mod?.readConfig || !mod?.writeConfig) return null;
  return { readConfig: mod.readConfig, writeConfig: mod.writeConfig };
}

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function aiPatchFromOptions(opts = {}) {
  const provider = String(opts.aiProvider || "").trim().toLowerCase();
  if (!provider) return {};

  if (!["openai", "anthropic", "xai", "openrouter", "ollama"].includes(provider)) {
    throw new Error("Invalid --ai-provider. Use openai|anthropic|xai|openrouter|ollama.");
  }

  if (provider === "ollama") {
    return {
      aiProvider: "ollama",
      openaiBaseUrl: opts.aiBaseUrl || DEFAULT_OLLAMA_BASE_URL,
      openaiModel: opts.aiModel || DEFAULT_OLLAMA_MODEL,
      ...(opts.aiKey ? { openaiApiKey: opts.aiKey } : {})
    };
  }

  if (provider === "openai") {
    return {
      aiProvider: "openai",
      ...(opts.aiKey ? { openaiApiKey: opts.aiKey } : {}),
      ...(opts.aiModel ? { openaiModel: opts.aiModel } : {}),
      ...(opts.aiBaseUrl ? { openaiBaseUrl: opts.aiBaseUrl } : {})
    };
  }

  if (provider === "anthropic") {
    return {
      aiProvider: "anthropic",
      ...(opts.aiKey ? { anthropicApiKey: opts.aiKey } : {}),
      ...(opts.aiModel ? { anthropicModel: opts.aiModel } : {}),
      ...(opts.aiBaseUrl ? { anthropicBaseUrl: opts.aiBaseUrl } : {})
    };
  }

  if (provider === "xai") {
    return {
      aiProvider: "xai",
      ...(opts.aiKey ? { xaiApiKey: opts.aiKey } : {}),
      ...(opts.aiModel ? { xaiModel: opts.aiModel } : {}),
      ...(opts.aiBaseUrl ? { xaiBaseUrl: opts.aiBaseUrl } : {})
    };
  }

  return {
    aiProvider: "openrouter",
    ...(opts.aiKey ? { openrouterApiKey: opts.aiKey } : {}),
    ...(opts.aiModel ? { openrouterModel: opts.aiModel } : {}),
    ...(opts.aiBaseUrl ? { openrouterBaseUrl: opts.aiBaseUrl } : {})
  };
}

function registerSetupCommands(program) {
  program
    .command("setup")
    .description("fast setup for client credentials, webhook token, and AI provider")
    .option("--client <name>", "client name (default: active client)")
    .option("--switch", "switch active client to --client", false)
    .option("--token <token>", "Meta permanent token")
    .option("--phone-id <id>", "Meta phone number id")
    .option("--business-id <id>", "Meta WABA id")
    .option("--verify-token <token>", "webhook verify token")
    .option("--generate-verify-token", "generate and save a webhook verify token", false)
    .option("--ai-provider <provider>", "openai|anthropic|xai|openrouter|ollama")
    .option("--ai-key <key>", "AI provider key")
    .option("--ai-model <model>", "AI model")
    .option("--ai-base-url <url>", "AI base URL override")
    .action(async (opts, cmd) => {
      const root = cmd.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = safeClientName(opts.client || cfg.activeClient || "default");
      const changes = [];

      const wantsClientWrite = !!(opts.token || opts.phoneId || opts.businessId);
      if (wantsClientWrite) {
        const prev = cfg.clients?.[client] || {};
        await addOrUpdateClient(
          client,
          {
            token: opts.token || prev.token || null,
            phoneNumberId: opts.phoneId || prev.phoneNumberId || null,
            wabaId: opts.businessId || prev.wabaId || null
          },
          { makeActive: !!opts.switch }
        );
        changes.push("client_credentials");
      } else if (opts.switch) {
        await switchClient(client);
        changes.push("active_client");
      }

      if (opts.verifyToken) {
        await setConfig({ webhookVerifyToken: opts.verifyToken });
        changes.push("webhook_verify_token");
      } else if (opts.generateVerifyToken) {
        const token = base64url(crypto.randomBytes(24));
        await setConfig({ webhookVerifyToken: token });
        changes.push("webhook_verify_token_generated");
      }

      const aiPatch = aiPatchFromOptions(opts);
      if (Object.keys(aiPatch).length) {
        await setConfig(aiPatch);
        changes.push("ai_config");
      }

      // TS migration bridge: keep canonical auth/webhook fields in sync when setup updates them.
      if (wantsClientWrite || opts.verifyToken || opts.generateVerifyToken) {
        try {
          const ts = await loadTsConfigBridge();
          if (ts) {
            const fresh = await getConfig();
            const active = fresh.clients?.[client] || {};
            await ts.writeConfig({
              token: String(active.token || fresh.token || ""),
              phoneNumberId: String(active.phoneNumberId || fresh.phoneNumberId || ""),
              businessId: String(active.wabaId || fresh.wabaId || ""),
              webhookVerifyToken: fresh.webhookVerifyToken ? String(fresh.webhookVerifyToken) : undefined,
              graphVersion: String(fresh.graphVersion || "v20.0"),
              baseUrl: String(fresh.baseUrl || "https://graph.facebook.com")
            });
          }
        } catch (err) {
          logger.warn(`TS setup bridge unavailable, continuing with legacy config: ${err?.message || err}`);
        }
      }

      const latest = await getConfig();
      const readiness = buildReadiness(latest, { client });
      const payload = { client: readiness.client, changes, readiness };

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, ...payload }, null, 2));
        return;
      }

      if (!changes.length) {
        logger.warn("No changes applied. Pass flags like --token/--phone-id/--business-id, --verify-token, or --ai-provider.");
      } else {
        logger.ok(`Setup updated for client '${readiness.client}'.`);
        logger.info(`Updated: ${changes.join(", ")}`);
      }
      logger.info(`Readiness: meta=${readiness.metaReady ? "ready" : "missing"} webhook=${readiness.webhookReady ? "ready" : "missing"} ai=${readiness.aiReady ? "ready" : "missing"}`);
      if (readiness.missing.length) logger.warn(`Missing: ${readiness.missing.join(", ")}`);
    });
}

module.exports = { registerSetupCommands, aiPatchFromOptions };
