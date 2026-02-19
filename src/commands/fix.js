const { logger } = require("../lib/logger");
const { getConfig, setConfig } = require("../lib/config");
const { addOrUpdateClient } = require("../lib/clients");
const { createWizardPrompter } = require("../lib/wizard/prompter");
const { WizardCancelledError } = require("../lib/wizard/prompts");
const { runGuidedDemo } = require("./demo");
const { loadTsConfigBridge } = require("../lib/ts-bridge");

function isDigits(value) {
  return /^\d+$/.test(String(value || "").trim());
}

async function askText(prompter, message, { optional = false, validate } = {}) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const value = String(await prompter.text({ message })).trim();
    if (!value && optional) return null;
    if (!value) {
      logger.warn("This field cannot be empty.");
      continue;
    }
    if (typeof validate === "function") {
      const reason = validate(value);
      if (reason) {
        logger.warn(reason);
        continue;
      }
    }
    return value;
  }
}

function choosePrimaryNextCommand(report) {
  const steps = report?.next?.steps || [];
  return steps[0]?.command || "waba check";
}

async function trySaveMetaCredentials(prompter, cfg) {
  const client = cfg.activeClient || "default";
  const token = await askText(prompter, "Paste access token:");
  const phoneId = await askText(prompter, "Phone number ID (digits only):", {
    validate: (v) => (isDigits(v) ? "" : "Phone number ID should contain only digits.")
  });
  const businessId = await askText(prompter, "WABA ID (digits only):", {
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

  try {
    const ts = await loadTsConfigBridge();
    if (ts) {
      await ts.writeConfig({
        token: String(token),
        phoneNumberId: String(phoneId),
        businessId: String(businessId)
      });
    }
  } catch (err) {
    logger.warn(`TS config bridge unavailable, saved JS config only: ${err?.message || err}`);
  }
}

async function ensureWebhookToken() {
  const cfg = await getConfig();
  if (cfg.webhookVerifyToken) return true;
  try {
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    await setConfig({ webhookVerifyToken: token });
    return true;
  } catch {
    return false;
  }
}

function registerFixCommands(program) {
  program
    .command("fix")
    .description("beginner auto-fix flow with simple prompts and one clear next step")
    .action(async (_opts, cmd) => {
      const root = cmd.parent || program;
      const json = !!root.opts()?.json;

      let report = await runGuidedDemo({ autoFix: true, scopeCheckMode: "best-effort" });
      if (report.ok) {
        if (json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ ok: true, next: "waba go" }, null, 2));
          return;
        }
        logger.ok("Everything looks good.");
        logger.info("Next: waba go");
        return;
      }

      const interactive = !!(process.stdin.isTTY && process.stdout.isTTY && !json);
      if (interactive) {
        const prompter = createWizardPrompter();
        try {
          if (!report.readiness.metaReady) {
            const doMeta = await prompter.confirm({
              message: "I can help fix this now. Add Meta credentials?",
              initialValue: true
            });
            if (doMeta) await trySaveMetaCredentials(prompter, await getConfig());
          }

          if (!report.readiness.webhookReady) {
            const doWebhook = await prompter.confirm({
              message: "Generate webhook verify token automatically?",
              initialValue: true
            });
            if (doWebhook) {
              const ok = await ensureWebhookToken();
              if (!ok) logger.warn("Could not write webhook token automatically.");
            }
          }
        } catch (err) {
          if (err instanceof WizardCancelledError) {
            logger.warn("Fix flow cancelled.");
            return;
          }
          throw err;
        }
      }

      report = await runGuidedDemo({ autoFix: true, scopeCheckMode: "best-effort" });
      const next = choosePrimaryNextCommand(report);

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: report.ok, next, readiness: report.readiness }, null, 2));
        if (!report.ok) process.exitCode = 1;
        return;
      }

      if (report.ok) {
        logger.ok("Fix complete.");
        logger.info("Next: waba go");
        return;
      }

      logger.warn("Still needs one manual step.");
      logger.info(`Run this: ${next}`);
      process.exitCode = 1;
    });
}

module.exports = {
  registerFixCommands,
  choosePrimaryNextCommand
};
