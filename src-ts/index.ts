// src-ts/index.ts
import { Command } from "commander";
import fs from "fs-extra";
import { readConfig, writeConfig, logsPath } from "./config.js";
import { runDoctor } from "./doctor.js";
import { MetaClient } from "./meta-client.js";
import { parseIntent } from "./engine/parser.js";
import { validateIntent } from "./engine/schema.js";
import { executeIntent } from "./engine/executor.js";
import { appendLog, logConsole } from "./logger.js";
import { getReplayById, listReplay } from "./replay.js";
import { assertReplayIntentHasRequiredPayload } from "./replay-guard.js";
import { shouldFailDoctorGate } from "./doctor-policy.js";
import { addOrUpdateClient, listClients, removeClient, switchClient } from "./clients.js";

async function requireConfigured() {
  const cfg = await readConfig();
  if (!cfg.token || !cfg.businessId || !cfg.phoneNumberId) {
    throw new Error("Missing config. Run: waba-ts login --token ... --business-id ... --phone-number-id ...");
  }
  return cfg;
}

function onboardingHints(): void {
  logConsole("WARN", "Setup incomplete for Hatch.");
  logConsole("INFO", "Run: waba-ts onboard");
  logConsole("INFO", "Then: waba-ts login --token <TOKEN> --business-id <ID> --phone-number-id <ID>");
}

async function ensureOnboardedForHatch(): Promise<boolean> {
  const cfg = await readConfig();
  const ok = !!(cfg.token && cfg.businessId && cfg.phoneNumberId);
  if (!ok) onboardingHints();
  return ok;
}

async function run() {
  const p = new Command();
  p.name("waba-ts").description("WABA Agent TypeScript control plane").option("--json", "json output", false);

  p.command("onboard").description("bootstrap config hints").action(async () => {
    const cfg = await readConfig();
    logConsole("INFO", `Config loaded. Path is ~/.waba-agent/config.json`);
    logConsole("INFO", `businessId=${cfg.businessId || "(missing)"} phoneNumberId=${cfg.phoneNumberId || "(missing)"}`);
    if (!cfg.token || !cfg.businessId || !cfg.phoneNumberId) onboardingHints();
  });

  p.command("login")
    .requiredOption("--token <token>")
    .requiredOption("--business-id <id>")
    .requiredOption("--phone-number-id <id>")
    .option("--webhook-url <url>")
    .option("--verify-token <token>")
    .option("--test-recipient <phone>")
    .option("--test-template <name>")
    .action(async (opts) => {
      const out = await writeConfig({
        token: String(opts.token),
        businessId: String(opts.businessId),
        phoneNumberId: String(opts.phoneNumberId),
        webhookUrl: opts.webhookUrl ? String(opts.webhookUrl) : undefined,
        webhookVerifyToken: opts.verifyToken ? String(opts.verifyToken) : undefined,
        testRecipient: opts.testRecipient ? String(opts.testRecipient) : undefined,
        testTemplate: opts.testTemplate ? String(opts.testTemplate) : undefined
      });
      logConsole("INFO", `Saved config: ${out}`);
    });

  p.command("doctor")
    .description("run connectivity and capability checks")
    .option("--scope-check-mode <mode>", "strict|best-effort", "best-effort")
    .option("--fail-on-warn", "exit non-zero when report overall is WARN", false)
    .action(async (opts) => {
      const cfg = await requireConfigured();
      const mode = String(opts.scopeCheckMode || "best-effort").toLowerCase();
      if (mode !== "strict" && mode !== "best-effort") {
        throw new Error("Invalid --scope-check-mode. Use strict|best-effort.");
      }
      const report = await runDoctor(cfg, { scopeCheckMode: mode });
      await appendLog("INFO", "doctor.report", report as unknown as Record<string, unknown>);
      if (p.opts().json) console.log(JSON.stringify(report, null, 2));
      else logConsole("INFO", JSON.stringify(report, null, 2));
      if (shouldFailDoctorGate(report, !!opts.failOnWarn)) {
        throw new Error(`Doctor gate failed: overall=${report.overall}`);
      }
    });

  p.command("status").description("show local setup status").action(async () => {
    const cfg = await readConfig();
    const status = {
      token: cfg.token ? "***set***" : "(missing)",
      businessId: cfg.businessId || "(missing)",
      phoneNumberId: cfg.phoneNumberId || "(missing)",
      webhookUrl: cfg.webhookUrl || "(missing)",
      logsPath: logsPath()
    };
    if (p.opts().json) console.log(JSON.stringify(status, null, 2));
    else logConsole("INFO", JSON.stringify(status, null, 2));
  });

  p.command("profile").action(async () => {
    const cfg = await requireConfigured();
    const intent = validateIntent({
      action: "get_profile",
      business_id: cfg.businessId,
      phone_number_id: cfg.phoneNumberId,
      payload: {},
      risk: "LOW"
    });
    const out = await executeIntent(intent, cfg);
    console.log(JSON.stringify(out.output, null, 2));
  });

  p.command("numbers").action(async () => {
    const cfg = await requireConfigured();
    const intent = validateIntent({
      action: "list_numbers",
      business_id: cfg.businessId,
      phone_number_id: cfg.phoneNumberId,
      payload: {},
      risk: "LOW"
    });
    const out = await executeIntent(intent, cfg);
    console.log(JSON.stringify(out.output, null, 2));
  });

  p.command("templates").description("list templates").action(async () => {
    const cfg = await requireConfigured();
    const api = new MetaClient(cfg);
    const out = await api.listTemplates();
    console.log(JSON.stringify(out, null, 2));
  });

  p.command("send")
    .requiredOption("--to <phone>")
    .requiredOption("--template <name>")
    .option("--language <code>", "template language", "en_US")
    .action(async (opts) => {
      const cfg = await requireConfigured();
      const intent = validateIntent({
        action: "send_template",
        business_id: cfg.businessId,
        phone_number_id: cfg.phoneNumberId,
        payload: {
          to: String(opts.to),
          templateName: String(opts.template),
          language: String(opts.language)
        },
        risk: "HIGH"
      });
      const out = await executeIntent(intent, cfg);
      console.log(JSON.stringify(out, null, 2));
    });

  p.command("logs")
    .option("--tail <n>", "tail lines", "50")
    .action(async (opts) => {
      const lp = logsPath();
      if (!(await fs.pathExists(lp))) {
        logConsole("WARN", "No logs yet.");
        return;
      }
      const raw = await fs.readFile(lp, "utf8");
      const lines = raw.split("\n").filter(Boolean).slice(-Number(opts.tail || 50));
      for (const line of lines) console.log(line);
    });

  p.command("replay")
    .argument("<id>", "replay id")
    .option("--dry-run", "validate replay intent without executing", false)
    .action(async (id, opts) => {
      const cfg = await requireConfigured();
      const row = await getReplayById(String(id));
      if (!row) throw new Error(`Replay id not found: ${id}`);
      const replayIntent = row.intent || {
        action: row.action,
        business_id: cfg.businessId,
        phone_number_id: cfg.phoneNumberId,
        payload: {},
        risk: row.risk
      };
      const intent = validateIntent(replayIntent);
      assertReplayIntentHasRequiredPayload(intent);
      if (opts.dryRun) {
        const out = {
          ok: true,
          dryRun: true,
          id: row.id,
          action: intent.action,
          risk: intent.risk,
          guard: "pass",
          intent
        };
        console.log(JSON.stringify(out, null, 2));
        return;
      }
      const out = await executeIntent(intent, cfg);
      console.log(JSON.stringify(out, null, 2));
    });

  p.command("replay-list")
    .option("--limit <n>", "max rows", "20")
    .action(async (opts) => {
      const rows = await listReplay(Number(opts.limit || 20));
      console.log(JSON.stringify(rows, null, 2));
    });

  const clients = p.command("clients").description("multi-client management (agency mode)");

  clients
    .command("list")
    .description("list configured clients")
    .action(async () => {
      const out = await listClients();
      if (p.opts().json) {
        console.log(JSON.stringify({ ok: true, ...out }, null, 2));
        return;
      }
      logConsole("INFO", `Active: ${out.activeClient}`);
      for (const x of out.clients) {
        const mark = x.name === out.activeClient ? "*" : " ";
        logConsole("INFO", `${mark} ${x.name} phoneId=${x.phoneNumberId || "-"} wabaId=${x.wabaId || "-"} token=${x.token || "-"}`);
      }
    });

  clients
    .command("add")
    .description("add or update a client credentials set")
    .argument("<name>", "client name (example: acme)")
    .requiredOption("--token <token>", "permanent token")
    .requiredOption("--phone-id <id>", "phone number id")
    .requiredOption("--business-id <id>", "WABA id")
    .option("--switch", "make this client active", false)
    .action(async (name, opts) => {
      const res = await addOrUpdateClient(
        String(name),
        {
          token: String(opts.token),
          phoneNumberId: String(opts.phoneId),
          wabaId: String(opts.businessId)
        },
        { makeActive: !!opts.switch }
      );
      logConsole("INFO", `Saved client '${res.name}' (${res.path})`);
      if (opts.switch) logConsole("INFO", `Active client: ${res.activeClient}`);
    });

  clients
    .command("switch")
    .description("switch active client")
    .argument("<name>", "client name")
    .action(async (name) => {
      const res = await switchClient(String(name));
      logConsole("INFO", `Active client: ${res.activeClient}`);
      logConsole("INFO", `Config: ${res.path}`);
    });

  clients
    .command("remove")
    .description("remove a client from config (does not delete memory files)")
    .argument("<name>", "client name")
    .action(async (name) => {
      const res = await removeClient(String(name));
      if (!res.removed) {
        logConsole("WARN", "Client not found.");
        return;
      }
      logConsole("INFO", `Removed client. Active: ${res.activeClient}`);
      logConsole("INFO", `Config: ${res.path}`);
    });

  p.command("tui").description("OpenClaw-style terminal control plane").action(async () => {
    if (!(await ensureOnboardedForHatch())) return;
    const { startHatchTui } = await import("../src/tui/index.js");
    startHatchTui();
  });

  p.command("hatch").description("Alias of tui (chat-first Hatch runtime)").action(async () => {
    if (!(await ensureOnboardedForHatch())) return;
    const { startHatchTui } = await import("../src/tui/index.js");
    startHatchTui();
  });

  await p.parseAsync(process.argv);
}

run().catch(async (err) => {
  await appendLog("ERROR", "cli.error", { message: String((err as Error).message || err) });
  logConsole("ERROR", String((err as Error).stack || err));
  process.exitCode = 1;
});
