const { Command } = require("commander");
const figlet = require("figlet");
const chalkImport = require("chalk");
const chalk = chalkImport.default || chalkImport;

const { registerAuthCommands } = require("./commands/auth");
const { registerWebhookCommands } = require("./commands/webhook");
const { registerTemplateCommands } = require("./commands/template");
const { registerSendCommands } = require("./commands/send");
const { registerAgentCommands } = require("./commands/agent");
const { registerMemoryCommands } = require("./commands/memory");
const { registerScheduleCommands } = require("./commands/schedule");
const { registerClientsCommands } = require("./commands/clients");
const { registerAnalyticsCommands } = require("./commands/analytics");
const { registerIntegrateCommands } = require("./commands/integrate");
const { registerSyncCommands } = require("./commands/sync");
const { registerCostCommands } = require("./commands/cost");
const { registerOptoutCommands } = require("./commands/optout");
const { registerCampaignCommands } = require("./commands/campaign");
const { registerOnboardCommands } = require("./commands/onboard");
const { registerReportCommands } = require("./commands/report");
const { registerFlowCommands } = require("./commands/flow");
const { registerPaymentsCommands } = require("./commands/payments");
const { registerDeployCommands } = require("./commands/deploy");
const { registerLogsCommands } = require("./commands/logs");
const { registerLeadsCommands } = require("./commands/leads");
const { registerExportCommands } = require("./commands/export");
const { registerAutopilotCommands } = require("./commands/autopilot");
const { registerAiCommands } = require("./commands/ai");
const { registerChatCommands } = require("./commands/chat");
const { registerGatewayCommands } = require("./commands/gateway");
const { registerResaleCommands } = require("./commands/resale");
const { registerOrderCommands } = require("./commands/order");

const pkg = require("../package.json");
const { logger } = require("./lib/logger");

async function main() {
  const program = new Command();

  program
    .name("waba")
    .description(pkg.description)
    .version(pkg.version)
    .option("--no-banner", "disable startup banner")
    .option("--json", "emit machine-readable JSON where supported", false)
    .option("--debug", "verbose logs", false)
    .option("--no-memory", "disable memory writes (useful for privacy-sensitive deployments)");

  // Recovery UX for mistyped/forgotten commands.
  program.showSuggestionAfterError(true);
  program.showHelpAfterError(chalk.yellow('\nTip: run "waba help" or try natural language with: waba ai "<intent>"'));

  program.hook("preAction", (cmd) => {
    const opts = cmd.opts();
    logger.setDebug(!!opts.debug);

    if (opts.banner !== false) {
      const text = figlet.textSync("WABA Agent", { horizontalLayout: "default" });
      // Keep it quiet in JSON mode.
      if (!opts.json) console.log(chalk.green(text));
    }
  });

  registerAuthCommands(program);
  registerWebhookCommands(program);
  registerTemplateCommands(program);
  registerSendCommands(program);
  registerAgentCommands(program);
  registerMemoryCommands(program);
  registerScheduleCommands(program);
  registerClientsCommands(program);
  registerAnalyticsCommands(program);
  registerIntegrateCommands(program);
  registerSyncCommands(program);
  registerCostCommands(program);
  registerOptoutCommands(program);
  registerCampaignCommands(program);
  registerOnboardCommands(program);
  registerReportCommands(program);
  registerFlowCommands(program);
  registerPaymentsCommands(program);
  registerDeployCommands(program);
  registerLogsCommands(program);
  registerLeadsCommands(program);
  registerExportCommands(program);
  registerAutopilotCommands(program);
  registerAiCommands(program);
  registerChatCommands(program);
  registerGatewayCommands(program);
  registerResaleCommands(program);
  registerOrderCommands(program);

  program
    .command("doctor")
    .description("check local setup and auth")
    .action(async () => {
      const { doctor } = require("./lib/doctor");
      await doctor({ json: program.opts().json });
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  logger.error(err?.stack || String(err));
  process.exitCode = 1;
});
