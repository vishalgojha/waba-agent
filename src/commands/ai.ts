// @ts-nocheck
const chalkImport = require("chalk");
const chalk = chalkImport.default || chalkImport;

const { getConfig } = require("../lib/config");
const { logger } = require("../lib/logger");
const { aiParseIntent } = require("../lib/ai/parser");
const { validateIntent } = require("../lib/ai/validator");
const { executeIntent } = require("../lib/ai/executor");
const { askForMissingFields } = require("../lib/ai/ask-missing");
const { showConfirmation } = require("../lib/ui/confirm");
const { formatParsedIntent } = require("../lib/ui/format");
const intents = require("../lib/ai/intents.json");

function toWaDigits(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

function manualFallbackCommand(intent) {
  if (!intent || !intent.action) return "waba --help";
  if (intent.action === "send_template") {
    return `waba send template ${toWaDigits(intent.phone)} --template-name "${intent.template || "template_name"}" --language en${intent.params ? ` --params '${JSON.stringify(intent.params)}'` : ""}${intent.client ? ` --client "${intent.client}"` : ""}`;
  }
  if (intent.action === "send_text") {
    return `waba send text ${toWaDigits(intent.phone)} --body "${intent.message || "hello"}"${intent.client ? ` --client "${intent.client}"` : ""}`;
  }
  if (intent.action === "schedule_text") {
    return `waba schedule add-text ${toWaDigits(intent.phone)} --body "${intent.message || "reminder"}" --at "${intent.datetime || "2026-02-18T10:00:00+05:30"}"${intent.client ? ` --client "${intent.client}"` : ""}`;
  }
  if (intent.action === "schedule_template") {
    return `waba schedule add-template ${toWaDigits(intent.phone)} --template-name "${intent.template || "template_name"}" --at "${intent.datetime || "2026-02-18T10:00:00+05:30"}"${intent.params ? ` --params '${JSON.stringify(intent.params)}'` : ""}${intent.client ? ` --client "${intent.client}"` : ""}`;
  }
  if (intent.action === "list_templates") return `waba template list${intent.client ? ` --client "${intent.client}"` : ""}`;
  if (intent.action === "webhook_setup") return `waba webhook setup --url "${intent.message || "https://your-public-url"}"`;
  if (intent.action === "show_memory") return `waba memory show "${intent.client || "default"}"`;
  return "waba --help";
}

function printValidation(validation) {
  logger.warn("Missing or invalid information:");
  for (const err of validation.errors) logger.error(`  - ${err}`);
  for (const suggestion of validation.suggestions) logger.info(`  -> ${suggestion}`);
}

function actionRisk(action) {
  return intents[action]?.risk || "low";
}

function isHighRisk(action) {
  return actionRisk(action) === "high";
}

function registerAiCommands(program) {
  program
    .command("ai")
    .description("Natural language interface (experimental)")
    .argument("<intent...>", "What you want to do in plain English")
    .option("--yes", "Skip confirmation for low/medium-risk actions", false)
    .option("--debug", "Show parsing details", false)
    .action(async (intentParts, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const text = Array.isArray(intentParts) ? intentParts.join(" ") : String(intentParts || "");
      const cfg = await getConfig();

      if (!json) logger.info("Understanding intent...");
      let intent = await aiParseIntent(text, cfg, { quiet: json && !opts.debug });
      if (opts.debug) logger.info(`Parsed: ${JSON.stringify(intent, null, 2)}`);

      let validation = validateIntent(intent);
      if (!validation.valid) {
        if (!json) printValidation(validation);
        if (validation.missingFields.length) {
          const completed = await askForMissingFields(intent, validation.missingFields);
          intent = { ...intent, ...completed };
          validation = validateIntent(intent);
        }
      }

      if (!validation.valid) {
        if (!json) printValidation(validation);
        const manual = manualFallbackCommand(intent);
        if (!json) {
          logger.warn("Could not safely execute via AI. Try manual command:");
          logger.info(manual);
        }
        if (json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ ok: false, reason: "invalid_intent", intent, validation, manual }, null, 2));
        }
        return;
      }

      if (!json) logger.info(`\n${formatParsedIntent(validation.intent)}`);

      let shouldConfirm = !opts.yes;
      if (isHighRisk(validation.intent.action)) {
        shouldConfirm = true;
        if (opts.yes && !json) logger.warn("Ignoring --yes for high-risk action. Interactive confirmation required.");
      }

      if (shouldConfirm) {
        const confirmed = await showConfirmation(validation.intent);
        if (!confirmed.confirmed) {
          if (!json) logger.warn("Cancelled.");
          if (json) {
            // eslint-disable-next-line no-console
            console.log(JSON.stringify({ ok: true, cancelled: true }, null, 2));
          }
          return;
        }
        intent = confirmed.intent;
        validation = validateIntent(intent);
        if (!validation.valid) {
          if (!json) printValidation(validation);
          const manual = manualFallbackCommand(intent);
          if (!json) {
            logger.warn("Edited intent is still invalid. Try manual command:");
            logger.info(manual);
          }
          if (json) {
            // eslint-disable-next-line no-console
            console.log(JSON.stringify({ ok: false, reason: "invalid_after_edit", intent, validation, manual }, null, 2));
          }
          return;
        }
      } else {
        intent = validation.intent;
      }

      const result = await executeIntent(intent, { config: cfg, quiet: json && !opts.debug });
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: result.success, intent, result }, null, 2));
        return;
      }
      if (result.success) {
        logger.ok("Done.");
        if (result.result !== null && result.result !== undefined) logger.info(JSON.stringify(result.result, null, 2));
      } else {
        logger.error(`Failed: ${result.error}`);
        logger.info(`Manual fallback: ${manualFallbackCommand(intent)}`);
      }
    });
}

module.exports = { registerAiCommands };
