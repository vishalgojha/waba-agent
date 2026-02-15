const { getConfig } = require("../lib/config");
const { WhatsAppCloudApi } = require("../lib/whatsapp");
const { logger } = require("../lib/logger");

function registerTemplateCommands(program) {
  const t = program.command("template").description("manage message templates");

  t.command("list")
    .description("list message templates (requires business/WABA ID)")
    .option("--limit <n>", "limit", (v) => Number(v), 50)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const api = new WhatsAppCloudApi({
        token: cfg.token,
        phoneNumberId: cfg.phoneNumberId,
        wabaId: cfg.wabaId,
        graphVersion: cfg.graphVersion || "v20.0",
        baseUrl: cfg.baseUrl
      });
      const data = await api.listTemplates({ limit: opts.limit });
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, data }, null, 2));
        return;
      }
      const rows = data?.data || [];
      logger.info(`Templates: ${rows.length}`);
      for (const r of rows) {
        logger.info(`${r.name} (${r.language}) - ${r.status} - ${r.category}`);
      }
    });
}

module.exports = { registerTemplateCommands };

