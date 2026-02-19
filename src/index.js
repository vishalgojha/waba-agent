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

const pkg = require("../package.json");
const { logger } = require("./lib/logger");
const { initObservability } = require("./lib/observability");
const { shouldAutoStart } = require("./lib/cli-autostart");
const { getConfig } = require("./lib/config");
const { requireClientCreds } = require("./lib/creds");
const { createHttpClient } = require("./lib/http");
const { loadTsOpsBridge, buildTsAgentConfigFromCreds } = require("./lib/ts-bridge");

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

  program
    .command("doctor")
    .description("check local setup and auth")
    .option("--scope-check-mode <mode>", "strict|best-effort", "best-effort")
    .option("--fail-on-warn", "exit non-zero when report overall is WARN", false)
    .action(async (opts) => {
      const { doctor } = require("./lib/doctor");
      await doctor({
        json: program.opts().json,
        scopeCheckMode: String(opts.scopeCheckMode || "best-effort"),
        failOnWarn: !!opts.failOnWarn
      });
    });

  program
    .command("profile")
    .description("show WhatsApp phone profile from Graph")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts) => {
      const cfg = await getConfig();
      const creds = requireClientCreds(cfg, opts.client);
      const bridge = await loadTsOpsBridge();
      if (bridge) {
        const intent = bridge.validateIntent({
          action: "get_profile",
          business_id: String(creds.wabaId || ""),
          phone_number_id: String(creds.phoneNumberId || ""),
          payload: {},
          risk: "LOW"
        });
        const out = await bridge.executeIntent(intent, buildTsAgentConfigFromCreds(cfg, creds));
        console.log(JSON.stringify(out.output, null, 2));
        return;
      }

      logger.warn("TS bridge unavailable for profile; using legacy HTTP fallback.");
      const http = createHttpClient({
        baseURL: `${String(cfg.baseUrl || "https://graph.facebook.com").replace(/\/+$/, "")}/${String(cfg.graphVersion || "v20.0")}`,
        token: creds.token
      });
      const res = await http.get(`/${creds.phoneNumberId}`);
      console.log(JSON.stringify(res.data, null, 2));
    });

  program
    .command("numbers")
    .description("list phone numbers for current business")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts) => {
      const cfg = await getConfig();
      const creds = requireClientCreds(cfg, opts.client);
      const bridge = await loadTsOpsBridge();
      if (bridge) {
        const intent = bridge.validateIntent({
          action: "list_numbers",
          business_id: String(creds.wabaId || ""),
          phone_number_id: String(creds.phoneNumberId || ""),
          payload: {},
          risk: "LOW"
        });
        const out = await bridge.executeIntent(intent, buildTsAgentConfigFromCreds(cfg, creds));
        console.log(JSON.stringify(out.output, null, 2));
        return;
      }

      logger.warn("TS bridge unavailable for numbers; using legacy HTTP fallback.");
      const http = createHttpClient({
        baseURL: `${String(cfg.baseUrl || "https://graph.facebook.com").replace(/\/+$/, "")}/${String(cfg.graphVersion || "v20.0")}`,
        token: creds.token
      });
      const res = await http.get(`/${creds.wabaId}/phone_numbers`);
      console.log(JSON.stringify(res.data, null, 2));
    });

  const rawArgs = process.argv.slice(2);
  const argv = shouldAutoStart(rawArgs) ? [...process.argv, "start"] : process.argv;
  await program.parseAsync(argv);
}

main().catch((err) => {
  logger.error(err?.stack || String(err));
  process.exitCode = 1;
});
