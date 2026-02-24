// @ts-nocheck
const chalkImport = require("chalk");
const chalk = chalkImport.default || chalkImport;
const inquirerImport = require("inquirer");
const inquirer = inquirerImport.default || inquirerImport;

const { getConfig } = require("../lib/config");
const { logger } = require("../lib/logger");
const { safeClientName } = require("../lib/creds");
const { HatchGatewayClient } = require("../lib/hatch/gateway-client");
const { startGatewayServer } = require("../server/gateway");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildGatewayBaseUrl(host, port) {
  const h = String(host || "127.0.0.1").trim() || "127.0.0.1";
  const p = Number(port || 3010);
  return `http://${h}:${p}`;
}

function formatPendingActions(actions) {
  const list = Array.isArray(actions) ? actions : [];
  if (!list.length) return ["No pending actions."];
  return list.map((a, idx) => {
    const id = String(a?.id || a?.action_id || `action-${idx + 1}`);
    const tool = String(a?.tool || a?.fn || a?.action || "unknown");
    const desc = String(a?.description || a?.summary || "");
    return `${idx + 1}. [${id}] ${tool}${desc ? ` - ${desc}` : ""}`;
  });
}

function normalizeSessionId(row) {
  return String(row?.id || row?.session_id || row?.sessionId || "");
}

async function ensureGatewayReachable({ client, language, host, port, startGateway, api }) {
  try {
    return { health: await api.health(), server: null };
  } catch (err) {
    if (!startGateway) {
      const baseURL = buildGatewayBaseUrl(host, port);
      throw new Error(
        `Gateway not reachable at ${baseURL}. Start it with \`waba gw --host ${host} --port ${port} --client ${client}\` or re-run with --start-gateway.`
      );
    }
    logger.warn("Gateway unreachable. Starting local gateway for hatch...");
    const out = await startGatewayServer({ host, port, client, language });
    await sleep(250);
    const health = await api.health();
    return { health, server: out.server };
  }
}

function printPendingActions(actions) {
  const lines = formatPendingActions(actions);
  for (const line of lines) {
    // eslint-disable-next-line no-console
    console.log(chalk.yellow(line));
  }
}

function printSessionHeader({ client, sessionId, pendingCount }) {
  // eslint-disable-next-line no-console
  console.log(chalk.cyan("\n=== WABA Hatch ==="));
  // eslint-disable-next-line no-console
  console.log(chalk.gray(`client=${client} session=${sessionId} pending=${pendingCount}`));
}

async function chooseSession({ api, client, language }) {
  const out = await api.sessions({ client });
  const rows = Array.isArray(out?.sessions) ? out.sessions : [];
  const choices = [
    { name: "Start new session", value: "__new__" },
    ...rows.slice(0, 20).map((s) => {
      const id = normalizeSessionId(s);
      const pending = Number(s?.pending_actions_count || s?.pending_actions?.length || 0);
      const name = s?.name ? String(s.name) : "session";
      return {
        name: `${id} | ${name} | pending=${pending}`,
        value: id
      };
    }),
    { name: "Cancel", value: "__cancel__" }
  ];
  const picked = await inquirer.prompt([
    { type: "list", name: "sessionChoice", message: "Select session", choices, pageSize: 15 }
  ]);

  if (picked.sessionChoice === "__cancel__") return null;
  if (picked.sessionChoice === "__new__") {
    const started = await api.startSession({ client, language });
    return started.session_id;
  }
  return String(picked.sessionChoice);
}

async function choosePendingAction({ pending, mode }) {
  const choices = [
    ...pending.map((a) => ({
      name: `[${String(a?.id || "")}] ${String(a?.tool || "unknown")} - ${String(a?.description || "").slice(0, 80)}`,
      value: String(a?.id || "")
    })),
    { name: "Cancel", value: "__cancel__" }
  ];
  const picked = await inquirer.prompt([
    { type: "list", name: "actionId", message: `${mode} pending action`, choices, pageSize: 15 }
  ]);
  if (picked.actionId === "__cancel__") return null;
  return String(picked.actionId);
}

async function runHatchLoop({ api, client, language, sessionId, timeoutMs = 45_000 }) {
  let activeSessionId = String(sessionId || "");
  let running = true;

  while (running) {
    let snapshot;
    try {
      const out = await api.getSession(activeSessionId);
      snapshot = out?.session || {};
    } catch (err) {
      logger.warn(`Could not load session ${activeSessionId}: ${err?.message || err}`);
      const next = await chooseSession({ api, client, language });
      if (!next) break;
      activeSessionId = next;
      continue;
    }

    const pending = Array.isArray(snapshot?.pending_actions) ? snapshot.pending_actions : [];
    printSessionHeader({ client, sessionId: activeSessionId, pendingCount: pending.length });

    const pick = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "Hatch action",
        choices: [
          { name: "Send message", value: "send" },
          { name: "Show pending actions", value: "pending" },
          { name: "Approve pending action", value: "approve" },
          { name: "Reject pending action", value: "reject" },
          { name: "Switch / new session", value: "session" },
          { name: "Show summary", value: "summary" },
          { name: "Exit hatch", value: "exit" }
        ]
      }
    ]);

    const action = String(pick.action || "");
    if (action === "exit") {
      running = false;
      continue;
    }

    if (action === "pending") {
      printPendingActions(pending);
      continue;
    }

    if (action === "send") {
      const input = await inquirer.prompt([
        { type: "input", name: "message", message: "Message to agent" }
      ]);
      const message = String(input.message || "").trim();
      if (!message) {
        logger.warn("Message is empty.");
        continue;
      }
      const out = await api.sendMessage(activeSessionId, message, {
        autoExecute: false,
        allowHighRisk: false
      });
      const reply = String(out?.reply || out?.response?.message || "");
      if (reply) {
        // eslint-disable-next-line no-console
        console.log(chalk.green(`Agent: ${reply}`));
      }
      const nextPending = Array.isArray(out?.pending_actions) ? out.pending_actions : [];
      logger.info(`Pending actions: ${nextPending.length}`);
      continue;
    }

    if (action === "approve") {
      if (!pending.length) {
        logger.info("No pending actions to approve.");
        continue;
      }
      const actionId = await choosePendingAction({ pending, mode: "Approve" });
      if (!actionId) continue;
      const out = await api.execute(activeSessionId, {
        actionId,
        allowHighRisk: false,
        timeoutMs
      });
      const exec = out?.execution || {};
      logger.ok(
        `Approved ${actionId}: total=${Number(exec.total || 0)} ok=${Number(exec.ok || 0)} failed=${Number(exec.failed || 0)}`
      );
      continue;
    }

    if (action === "reject") {
      if (!pending.length) {
        logger.info("No pending actions to reject.");
        continue;
      }
      const actionId = await choosePendingAction({ pending, mode: "Reject" });
      if (!actionId) continue;
      const out = await api.reject(activeSessionId, { actionId });
      logger.ok(`Rejected ${actionId}. pending=${Number(out?.pending || 0)}`);
      continue;
    }

    if (action === "session") {
      const next = await chooseSession({ api, client, language });
      if (!next) continue;
      activeSessionId = next;
      logger.ok(`Switched session: ${activeSessionId}`);
      continue;
    }

    if (action === "summary") {
      const out = await api.summary({ client, days: 30 });
      const m = out?.metrics || {};
      // eslint-disable-next-line no-console
      console.log(
        chalk.gray(
          `sessions=${Number(m.sessions || 0)} messages=${Number(m.messages || 0)} pending=${Number(m.pending || 0)} executed=${Number(m.executed || 0)}`
        )
      );
    }
  }
}

function registerHatchCommands(program) {
  async function runFromCommand(opts, cmd) {
    const root = cmd.parent?.parent || program;
    await runHatchCommand(opts, root);
  }

  program
    .command("hatch")
    .alias("ht")
    .description("terminal hatch for gateway sessions (approval queue aware)")
    .option("-H, --host <host>", "gateway host", "127.0.0.1")
    .option("-p, --port <n>", "gateway port", (v) => Number(v), 3010)
    .option("-c, --client <name>", "client context")
    .option("-l, --lang <lang>", "language en|hi", "en")
    .option("--session <id>", "start with session id")
    .option("--start-gateway", "start local gateway automatically if unreachable", false)
    .option("--timeout-ms <n>", "execute timeout in ms", (v) => Number(v), 45_000)
    .action(runFromCommand);
}

async function runHatchCommand(opts = {}, rootProgram = null) {
  if (rootProgram?.opts?.().json) throw new Error("--json is not supported for interactive hatch.");
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("waba hatch requires an interactive TTY.");
  }

  const cfg = await getConfig();
  const client = safeClientName(opts.client || cfg.activeClient || "default");
  const language = opts.lang === "hi" ? "hi" : "en";
  const baseURL = buildGatewayBaseUrl(opts.host, opts.port);
  const api = new HatchGatewayClient({ baseURL });

  let startedServer = null;
  try {
    const { health, server } = await ensureGatewayReachable({
      client,
      language,
      host: opts.host,
      port: opts.port,
      startGateway: !!opts.startGateway,
      api
    });
    startedServer = server;
    logger.ok(`Gateway reachable: ${health?.service || "waba-gateway"} uptime=${Number(health?.uptime || 0)}s`);

    const sessionBoot = await api.startSession({
      sessionId: opts.session || null,
      client,
      language
    });
    const sessionId = String(sessionBoot?.session_id || sessionBoot?.session?.id || "");
    if (!sessionId) throw new Error("Could not initialize hatch session.");
    logger.ok(`Hatch session: ${sessionId}`);
    await runHatchLoop({
      api,
      client,
      language,
      sessionId,
      timeoutMs: Number(opts.timeoutMs || 45_000)
    });
  } finally {
    if (startedServer) {
      await new Promise((resolve) => startedServer.close(resolve));
      logger.info("Stopped auto-started gateway.");
    }
  }
}

module.exports = {
  registerHatchCommands,
  buildGatewayBaseUrl,
  formatPendingActions,
  runHatchCommand
};
