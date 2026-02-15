const { Command } = require("commander");
const figlet = require("figlet");
const chalk = require("chalk");

const { registerAuthCommands } = require("./commands/auth");
const { registerWebhookCommands } = require("./commands/webhook");
const { registerTemplateCommands } = require("./commands/template");
const { registerSendCommands } = require("./commands/send");
const { registerAgentCommands } = require("./commands/agent");
const { registerMemoryCommands } = require("./commands/memory");
const { registerScheduleCommands } = require("./commands/schedule");

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
