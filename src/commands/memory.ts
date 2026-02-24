// @ts-nocheck
const { listClients, readMemory, forgetClient } = require("../lib/memory");
const { askYesNo } = require("../lib/prompt");
const { logger } = require("../lib/logger");

function registerMemoryCommands(program) {
  const m = program.command("memory").description("per-client memory store (~/.waba/context/<client>/memory.jsonl)");

  m.command("list")
    .description("list clients with memory")
    .action(async () => {
      const clients = await listClients();
      logger.info(`Clients: ${clients.length}`);
      for (const c of clients) logger.info(c);
    });

  m.command("show")
    .description("show recent memory events for a client")
    .argument("<client>", "client name")
    .option("--limit <n>", "max events", (v) => Number(v), 50)
    .action(async (client, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const events = await readMemory(client, { limit: opts.limit });
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, events }, null, 2));
        return;
      }
      logger.info(`Events: ${events.length}`);
      for (const e of events) logger.info(JSON.stringify(e, null, 2));
    });

  m.command("forget")
    .description("delete a client's memory folder (irreversible)")
    .argument("<client>", "client name")
    .option("--yes", "skip confirmation", false)
    .action(async (client, opts) => {
      const ok = opts.yes ? true : await askYesNo(`Delete memory for '${client}'?`, { defaultYes: false });
      if (!ok) return;
      const removed = await forgetClient(client);
      if (removed) logger.ok(`Deleted memory for ${client}`);
      else logger.warn(`No memory found for ${client}`);
    });
}

module.exports = { registerMemoryCommands };
