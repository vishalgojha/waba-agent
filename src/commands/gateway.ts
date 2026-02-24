// @ts-nocheck
const { startGatewayServer } = require("../server/gateway");
const { getConfig } = require("../lib/config");
const { logger } = require("../lib/logger");
const { ensureOllamaRunning } = require("../lib/ai/ollama-autostart");

async function startGateway(opts = {}, rootProgram) {
  if (rootProgram?.opts()?.json) throw new Error("--json not supported for long-running gateway.");
  const cfg = await getConfig();
  await ensureOllamaRunning({ cfg, logger });
  await startGatewayServer({
    host: opts.host,
    port: opts.port,
    client: opts.client,
    language: opts.lang
  });
}

function registerGatewayCommands(program) {
  const g = program
    .command("gateway")
    .alias("gw")
    .description("local web gateway (UI + conversational API)")
    .option("-H, --host <host>", "bind host", "127.0.0.1")
    .option("-p, --port <n>", "port", (v) => Number(v), 3010)
    .option("-c, --client <name>", "default client context")
    .option("-l, --lang <lang>", "default language en|hi", "en")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      await startGateway(opts, root);
    });

  g.command("start")
    .alias("s")
    .description("start localhost gateway UI")
    .option("-H, --host <host>", "bind host", "127.0.0.1")
    .option("-p, --port <n>", "port", (v) => Number(v), 3010)
    .option("-c, --client <name>", "default client context")
    .option("-l, --lang <lang>", "default language en|hi", "en")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      await startGateway(opts, root);
    });
}

module.exports = { registerGatewayCommands };
