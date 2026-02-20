const chalkImport = require("chalk");
const chalk = chalkImport.default || chalkImport;

const { getConfig } = require("../lib/config");
const { logger } = require("../lib/logger");
const { ChatSession } = require("../lib/chat/session");
const { PersistentMemory } = require("../lib/chat/memory");
const { safeClientName } = require("../lib/creds");
const { ensureOllamaRunning } = require("../lib/ai/ollama-autostart");

function printHistory(rows) {
  if (!rows.length) {
    logger.info("No chat history found.");
    return;
  }
  logger.info(`Conversations: ${rows.length}`);
  for (const row of rows) {
    const ts = row.updatedAt || "-";
    const lang = row.language || "en";
    const recent = row.recent ? ` | ${row.recent}` : "";
    // eslint-disable-next-line no-console
    console.log(chalk.gray(`${row.sessionId} | ${ts} | ${lang}${recent}`));
  }
}

function registerChatCommands(program) {
  const chat = program
    .command("chat")
    .description("Start conversation with WhatsApp AI agent")
    .option("--client <name>", "Client context (e.g., acme, xyz-realty)")
    .option("--session <id>", "Resume previous conversation by session id")
    .option("--lang <lang>", "Language: en|hi", "en")
    .option("--resume", "Resume most recent session for this client", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      if (root.opts().json) throw new Error("--json is not supported for interactive chat.");

      const cfg = await getConfig();
      await ensureOllamaRunning({ cfg, logger });
      const client = safeClientName(opts.client || cfg.activeClient || "default");
      let sessionId = opts.session || null;
      if (!sessionId && opts.resume) {
        sessionId = await PersistentMemory.latestSessionId(client);
        if (!sessionId) logger.warn(`No previous session found for ${client}. Starting new session.`);
      }

      const session = new ChatSession({
        client,
        sessionId,
        language: opts.lang
      });
      await session.start();
    });

  chat
    .command("history")
    .description("Show recent conversations")
    .option("--client <name>", "Filter by client")
    .option("--limit <n>", "max sessions", (v) => Number(v), 20)
    .action(async (opts) => {
      const cfg = await getConfig();
      await ensureOllamaRunning({ cfg, logger });
      const client = safeClientName(opts.client || cfg.activeClient || "default");
      const rows = await PersistentMemory.history({ client, limit: opts.limit });
      printHistory(rows);
    });

  chat
    .command("resume")
    .description("Resume last conversation")
    .option("--client <name>", "client context")
    .option("--lang <lang>", "Language: en|hi", "en")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      if (root.opts().json) throw new Error("--json is not supported for interactive chat.");

      const cfg = await getConfig();
      const client = safeClientName(opts.client || cfg.activeClient || "default");
      const sessionId = await PersistentMemory.latestSessionId(client);
      if (!sessionId) {
        logger.warn(`No previous session found for ${client}. Starting a new session.`);
      }
      const session = new ChatSession({
        client,
        sessionId,
        language: opts.lang
      });
      await session.start();
    });
}

module.exports = { registerChatCommands };
