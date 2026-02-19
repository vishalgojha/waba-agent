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
const { registerHatchCommands } = require("./commands/hatch");
const { registerResaleCommands } = require("./commands/resale");
const { registerStartCommands } = require("./commands/start");
const { registerConfigCommands } = require("./commands/config");
const { registerSetupCommands } = require("./commands/setup");
const { registerStatusCommands } = require("./commands/status");
const { registerDemoCommands } = require("./commands/demo");
const { registerCheckCommands } = require("./commands/check");
const { registerFixCommands } = require("./commands/fix");
const { registerPanicCommands } = require("./commands/panic");
const {
  registerTsCommands,
  runTsDoctor,
  runTsProfile,
  runTsNumbers,
  runTsReplay,
  runTsReplayList
} = require("./commands/ts");

const pkg = require("../package.json");
const { logger } = require("./lib/logger");
const { initObservability } = require("./lib/observability");
const { shouldAutoStart } = require("./lib/cli-autostart");
const { collectKnownCommandNames, resolveFriendlyCommand } = require("./lib/friendly-router");
const { getConfig } = require("./lib/config");
const { requireClientCreds } = require("./lib/creds");
const { createHttpClient } = require("./lib/http");

function resolveServiceName(argv = process.argv.slice(2)) {
  const args = Array.isArray(argv) ? argv.map((x) => String(x || "").toLowerCase()) : [];
  if (args.includes("gateway") || args.includes("gw")) return "waba-gateway";
  if (args.includes("webhook")) return "waba-webhook";
  return "waba-cli";
}

async function main() {
  await initObservability({
    serviceName: resolveServiceName(process.argv.slice(2)),
    serviceVersion: pkg.version
  });

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
  registerHatchCommands(program);
  registerResaleCommands(program);
  registerStartCommands(program);
  registerConfigCommands(program);
  registerSetupCommands(program);
  registerStatusCommands(program);
  registerDemoCommands(program);
  registerCheckCommands(program);
  registerFixCommands(program);
  registerPanicCommands(program);
  registerTsCommands(program);

  program
    .command("doctor")
    .description("check local setup and auth")
    .option("--scope-check-mode <mode>", "strict|best-effort", "best-effort")
    .option("--fail-on-warn", "exit non-zero when report overall is WARN", false)
    .action(async (opts) => {
      logger.info("Beginner tip: use `waba check` for simple setup guidance.");
      logger.warn("Deprecated path: `waba doctor` now routes to `waba ts doctor`. Use `waba ts doctor` directly.");
      try {
        await runTsDoctor({
          json: program.opts().json,
          scopeCheckMode: String(opts.scopeCheckMode || "best-effort"),
          failOnWarn: !!opts.failOnWarn
        });
      } catch (err) {
        logger.warn(`TS doctor route unavailable, falling back to legacy doctor: ${err?.message || err}`);
        const { doctor } = require("./lib/doctor");
        await doctor({
          json: program.opts().json,
          scopeCheckMode: String(opts.scopeCheckMode || "best-effort"),
          failOnWarn: !!opts.failOnWarn
        });
      }
    });

  program
    .command("profile")
    .description("show WhatsApp phone profile from Graph")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts) => {
      logger.warn("Deprecated path: `waba profile` now routes to `waba ts profile`. Use `waba ts profile` directly.");
      try {
        await runTsProfile({ client: opts.client });
      } catch (err) {
        logger.warn(`TS profile route unavailable, falling back to legacy HTTP path: ${err?.message || err}`);
        const cfg = await getConfig();
        const creds = requireClientCreds(cfg, opts.client);
        const http = createHttpClient({
          baseURL: `${String(cfg.baseUrl || "https://graph.facebook.com").replace(/\/+$/, "")}/${String(cfg.graphVersion || "v20.0")}`,
          token: creds.token
        });
        const res = await http.get(`/${creds.phoneNumberId}`);
        console.log(JSON.stringify(res.data, null, 2));
      }
    });

  program
    .command("numbers")
    .description("list phone numbers for current business")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts) => {
      logger.warn("Deprecated path: `waba numbers` now routes to `waba ts numbers`. Use `waba ts numbers` directly.");
      try {
        await runTsNumbers({ client: opts.client });
      } catch (err) {
        logger.warn(`TS numbers route unavailable, falling back to legacy HTTP path: ${err?.message || err}`);
        const cfg = await getConfig();
        const creds = requireClientCreds(cfg, opts.client);
        const http = createHttpClient({
          baseURL: `${String(cfg.baseUrl || "https://graph.facebook.com").replace(/\/+$/, "")}/${String(cfg.graphVersion || "v20.0")}`,
          token: creds.token
        });
        const res = await http.get(`/${creds.wabaId}/phone_numbers`);
        console.log(JSON.stringify(res.data, null, 2));
      }
    });

  program
    .command("replay-list")
    .description("deprecated: use `waba ts replay-list`")
    .option("--limit <n>", "max rows", (v) => Number(v), 20)
    .action(async (opts) => {
      logger.warn("Deprecated path: `waba replay-list` now routes to `waba ts replay-list`.");
      await runTsReplayList({ limit: opts.limit });
    });

  program
    .command("replay")
    .description("deprecated: use `waba ts replay <id>`")
    .argument("<id>", "replay id")
    .option("--dry-run", "validate replay without execution", false)
    .action(async (id, opts) => {
      logger.warn("Deprecated path: `waba replay` now routes to `waba ts replay`.");
      await runTsReplay({ id, dryRun: !!opts.dryRun });
    });

  const rawArgs = process.argv.slice(2);
  let argv = shouldAutoStart(rawArgs) ? [...process.argv, "start"] : process.argv;

  if (!shouldAutoStart(rawArgs)) {
    const known = collectKnownCommandNames(program);
    const resolved = resolveFriendlyCommand(rawArgs, known);
    if (resolved) {
      logger.warn(`Interpreted '${resolved.original}' as '${resolved.target}'.`);
      argv = [...process.argv.slice(0, 2), ...resolved.rewritten];
    }
  }

  await program.parseAsync(argv);
}

main().catch((err) => {
  logger.error(err?.stack || String(err));
  process.exitCode = 1;
});
