// @ts-nocheck
const { logger } = require("../lib/logger");
const { getStorageStatus } = require("../lib/db/sqlite-store");
const { migrateJsonlMemoryToSqlite } = require("../lib/storage/migrate-memory");

function registerStorageCommands(program) {
  const s = program.command("storage").description("storage diagnostics and migration helpers");

  s.command("status")
    .description("show SQLite storage adapter status")
    .action((_opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const json = !!root.opts()?.json;
      const status = getStorageStatus();
      const out = {
        ...status,
        readMode: String(process.env.WABA_STORAGE_READ || "json")
      };
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, storage: out }, null, 2));
        return;
      }
      logger.info(`SQLite enabled: ${out.enabled ? "yes" : "no"}`);
      logger.info(`Reason: ${out.reason}`);
      logger.info(`DB path: ${out.dbPath}`);
      logger.info(`Read mode: ${out.readMode}`);
    });

  s.command("migrate-memory")
    .description("import memory JSONL into SQLite (phase-1 migration)")
    .option("--client <name>", "migrate only one client")
    .option("--dry-run", "scan and count without writing", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const json = !!root.opts()?.json;
      const out = await migrateJsonlMemoryToSqlite({
        client: opts.client || null,
        dryRun: !!opts.dryRun
      });
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(out, null, 2));
        if (!out.ok) process.exitCode = 1;
        return;
      }
      logger.info(`Storage enabled: ${out.storage.enabled ? "yes" : "no"} (${out.storage.reason})`);
      logger.info(`Scanned clients: ${out.scannedClients}`);
      logger.info(`Imported events: ${out.importedEvents}`);
      logger.info(`Skipped lines: ${out.skippedLines}`);
      if (out.errors.length) {
        logger.warn(`Errors: ${out.errors.length}`);
        for (const e of out.errors.slice(0, 5)) logger.warn(e);
      }
      if (!out.ok) process.exitCode = 1;
    });
}

module.exports = { registerStorageCommands };
