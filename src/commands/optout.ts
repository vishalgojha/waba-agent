// @ts-nocheck
const { getConfig } = require("../lib/config");
const { addOptout, readOptouts, isOptedOut, removeOptout } = require("../lib/optout-store");
const { logger } = require("../lib/logger");

function registerOptoutCommands(program) {
  const o = program.command("optout").description("compliance: opt-out / do-not-message list (per client)");

  o.command("add")
    .description("add a number to opt-out list")
    .argument("<number>", "E.164 without + (example: 9198xxxxxx)")
    .option("--client <name>", "client name (default: active client)")
    .option("--reason <text>", "reason", "user-request")
    .option("--source <text>", "source", "manual")
    .action(async (number, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const out = await addOptout(client, number, { reason: opts.reason, source: opts.source });
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, ...out }, null, 2));
        return;
      }
      if (out.added) logger.ok(`Opted out: ${out.record.number} (${client})`);
      else logger.warn(`Already opted out: ${out.record.number} (${client})`);
    });

  o.command("list")
    .description("list opt-outs")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const list = await readOptouts(client);
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, list }, null, 2));
        return;
      }
      logger.info(`Opt-outs (${client}): ${list.length}`);
      for (const x of list) logger.info(`${x.number} (${x.reason}) ${x.addedAt}`);
    });

  o.command("check")
    .description("check if a number is opted out")
    .argument("<number>", "number")
    .option("--client <name>", "client name (default: active client)")
    .action(async (number, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const ok = await isOptedOut(client, number);
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, optedOut: ok }, null, 2));
        return;
      }
      if (ok) logger.warn(`OPTED OUT (${client})`);
      else logger.ok(`not opted out (${client})`);
    });

  o.command("remove")
    .description("remove a number from opt-out list")
    .argument("<number>", "number")
    .option("--client <name>", "client name (default: active client)")
    .action(async (number, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const out = await removeOptout(client, number);
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, ...out }, null, 2));
        return;
      }
      if (out.removed) logger.ok(`Removed opt-out (${client})`);
      else logger.warn("Not found.");
    });
}

module.exports = { registerOptoutCommands };

