const { logger } = require("../lib/logger");
const { requireClientCreds } = require("../lib/creds");
const {
  loadTsConfigBridge,
  loadTsDoctorBridge,
  loadTsOpsBridge,
  loadTsMetaClientBridge,
  loadTsReplayBridge,
  loadTsTuiBridge,
  buildTsAgentConfigFromCreds
} = require("../lib/ts-bridge");

async function requireTsConfig() {
  const bridge = await loadTsConfigBridge();
  if (!bridge?.readConfig) throw new Error("TypeScript runtime is unavailable. Run: npm.cmd run build:ts:tmp");
  return bridge.readConfig();
}

function registerTsCommands(program) {
  const t = program.command("ts").description("TypeScript control-plane runtime (migration path)");

  t.command("status")
    .description("show TS runtime status/config summary")
    .action(async (_opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await requireTsConfig();
      const out = {
        token: cfg.token ? "***set***" : "(missing)",
        businessId: cfg.businessId || "(missing)",
        phoneNumberId: cfg.phoneNumberId || "(missing)",
        webhookUrl: cfg.webhookUrl || "(missing)",
        baseUrl: cfg.baseUrl || "https://graph.facebook.com",
        graphVersion: cfg.graphVersion || "v20.0"
      };
      if (json) {
        console.log(JSON.stringify({ ok: true, status: out }, null, 2));
        return;
      }
      logger.info(JSON.stringify(out, null, 2));
    });

  t.command("doctor")
    .description("run TS doctor checks")
    .option("--scope-check-mode <mode>", "strict|best-effort", "best-effort")
    .option("--fail-on-warn", "exit non-zero on WARN", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const bridge = await loadTsDoctorBridge();
      if (!bridge) throw new Error("TypeScript doctor runtime is unavailable. Run: npm.cmd run build:ts:tmp");
      const cfg = await bridge.readConfig();
      const mode = String(opts.scopeCheckMode || "best-effort").toLowerCase();
      const report = await bridge.runDoctor(cfg, { scopeCheckMode: mode });
      const gateFail = bridge.shouldFailDoctorGate(report, !!opts.failOnWarn);
      if (json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        logger.info(JSON.stringify(report, null, 2));
      }
      if (gateFail) throw new Error(`Doctor gate failed: overall=${report.overall}`);
    });

  t.command("profile")
    .description("run TS get_profile action")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts) => {
      const cfg = await requireTsConfig();
      const creds = requireClientCreds(
        {
          activeClient: "default",
          clients: { default: { token: cfg.token, phoneNumberId: cfg.phoneNumberId, wabaId: cfg.businessId } },
          token: cfg.token,
          phoneNumberId: cfg.phoneNumberId,
          wabaId: cfg.businessId
        },
        opts.client
      );
      const ops = await loadTsOpsBridge();
      if (!ops) throw new Error("TypeScript ops runtime is unavailable. Run: npm.cmd run build:ts:tmp");
      const intent = ops.validateIntent({
        action: "get_profile",
        business_id: String(creds.wabaId || ""),
        phone_number_id: String(creds.phoneNumberId || ""),
        payload: {},
        risk: "LOW"
      });
      const out = await ops.executeIntent(intent, buildTsAgentConfigFromCreds(cfg, creds));
      console.log(JSON.stringify(out.output, null, 2));
    });

  t.command("numbers")
    .description("run TS list_numbers action")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts) => {
      const cfg = await requireTsConfig();
      const creds = requireClientCreds(
        {
          activeClient: "default",
          clients: { default: { token: cfg.token, phoneNumberId: cfg.phoneNumberId, wabaId: cfg.businessId } },
          token: cfg.token,
          phoneNumberId: cfg.phoneNumberId,
          wabaId: cfg.businessId
        },
        opts.client
      );
      const ops = await loadTsOpsBridge();
      if (!ops) throw new Error("TypeScript ops runtime is unavailable. Run: npm.cmd run build:ts:tmp");
      const intent = ops.validateIntent({
        action: "list_numbers",
        business_id: String(creds.wabaId || ""),
        phone_number_id: String(creds.phoneNumberId || ""),
        payload: {},
        risk: "LOW"
      });
      const out = await ops.executeIntent(intent, buildTsAgentConfigFromCreds(cfg, creds));
      console.log(JSON.stringify(out.output, null, 2));
    });

  t.command("templates")
    .description("run TS template list")
    .action(async () => {
      const cfg = await requireTsConfig();
      const meta = await loadTsMetaClientBridge();
      if (!meta) throw new Error("TypeScript meta runtime is unavailable. Run: npm.cmd run build:ts:tmp");
      const api = new meta.MetaClient({
        token: cfg.token || "",
        businessId: cfg.businessId || "",
        phoneNumberId: cfg.phoneNumberId || "",
        graphVersion: cfg.graphVersion || "v20.0",
        baseUrl: cfg.baseUrl || "https://graph.facebook.com"
      });
      const out = await api.listTemplates();
      console.log(JSON.stringify(out, null, 2));
    });

  t.command("replay-list")
    .description("list TS replay entries")
    .option("--limit <n>", "max rows", (v) => Number(v), 20)
    .action(async (opts) => {
      const replay = await loadTsReplayBridge();
      if (!replay) throw new Error("TypeScript replay runtime is unavailable. Run: npm.cmd run build:ts:tmp");
      const rows = await replay.listReplay(Number(opts.limit || 20));
      console.log(JSON.stringify(rows, null, 2));
    });

  t.command("replay")
    .description("execute replay entry through TS runtime")
    .argument("<id>", "replay id")
    .option("--dry-run", "validate without execute", false)
    .action(async (id, opts) => {
      const cfg = await requireTsConfig();
      const replay = await loadTsReplayBridge();
      const ops = await loadTsOpsBridge();
      if (!replay || !ops) throw new Error("TypeScript replay runtime is unavailable. Run: npm.cmd run build:ts:tmp");
      const row = await replay.getReplayById(String(id));
      if (!row) throw new Error(`Replay id not found: ${id}`);
      const replayIntent = row.intent || {
        action: row.action,
        business_id: cfg.businessId || "",
        phone_number_id: cfg.phoneNumberId || "",
        payload: {},
        risk: row.risk
      };
      const intent = replay.validateIntent(replayIntent);
      replay.assertReplayIntentHasRequiredPayload(intent);
      if (opts.dryRun) {
        console.log(JSON.stringify({ ok: true, dryRun: true, id: row.id, action: intent.action, risk: intent.risk }, null, 2));
        return;
      }
      const out = await ops.executeIntent(intent, {
        token: cfg.token || "",
        businessId: cfg.businessId || "",
        phoneNumberId: cfg.phoneNumberId || "",
        graphVersion: cfg.graphVersion || "v20.0",
        baseUrl: cfg.baseUrl || "https://graph.facebook.com"
      });
      console.log(JSON.stringify(out, null, 2));
    });

  t.command("hatch")
    .description("launch TS Hatch TUI runtime")
    .action(async () => {
      const tui = await loadTsTuiBridge();
      if (!tui?.startHatchTui) throw new Error("TypeScript TUI runtime is unavailable. Run: npm.cmd run build:ts:tmp");
      tui.startHatchTui();
    });
}

module.exports = { registerTsCommands };
