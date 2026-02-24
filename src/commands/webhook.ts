// @ts-nocheck
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const fs = require("fs-extra");

const { getConfig, setConfig } = require("../lib/config");
const { logger } = require("../lib/logger");
const { createWebhookServer } = require("../lib/webhook/server");
const { extractMessages, extractStatuses } = require("../lib/webhook/parse");
const { sampleTextInbound } = require("../lib/webhook/payloads");
const { WhatsAppCloudApi } = require("../lib/whatsapp");
const { visionDescribe, transcribeAudioFile } = require("../lib/ai/openai");
const { appendMemory } = require("../lib/memory");
const { startWebhookServer } = require("../server/webhook");
const { requireClientCreds } = require("../lib/creds");

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function containsHindi(s) {
  return /[\u0900-\u097F]/.test(String(s || ""));
}

function registerWebhookCommands(program) {
  const w = program.command("webhook").description("webhook setup, serve, and test utilities");

  w.command("setup")
    .description("generate and store a webhook verify token; print Meta setup steps")
    .requiredOption("--url <url>", "public base URL (ngrok / server), example: https://xxxx.ngrok-free.app")
    .option("--no-save", "do not persist verify token")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const verifyToken = base64url(crypto.randomBytes(24));
      const normalized = String(opts.url).replace(/\/+$/, "");
      const callbackUrl = `${normalized}/webhook`;

      if (opts.save !== false) await setConfig({ webhookVerifyToken: verifyToken });

      const out = {
        callbackUrl,
        verifyToken,
        metaSteps: [
          "Go to Meta Developers > Your App > WhatsApp > Configuration",
          `Set Callback URL to: ${callbackUrl}`,
          "Set Verify Token to the generated value",
          "Subscribe to webhook fields: messages, message_status",
          "Send a test message to your WhatsApp number to confirm delivery"
        ]
      };

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, ...out }, null, 2));
        return;
      }
      logger.ok("Webhook verify token generated.");
      logger.info(`Callback URL: ${callbackUrl}`);
      logger.info(`Verify token: ${verifyToken}`);
      logger.warn("Optional hardening: set WABA_APP_SECRET (or save appSecret in config) to verify X-Hub-Signature-256.");
    });

  w.command("serve")
    .description("start a local webhook server (GET verify + POST events)")
    .option("--port <n>", "port", (v) => Number(v), 3000)
    .option("--path <path>", "path (default: /webhook)", "/webhook")
    .option("--client <name>", "client name (config + memory). Default: active client")
    .option("--auto-classify", "classify inbound text and show suggested reply (no outbound sends)", false)
    .option("--auto-reply", "send auto-replies to inbound text (requires --allow-outbound)", false)
    .option("--allow-outbound", "explicitly allow outbound sends from webhook server (costs money)", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json, memory } = root.opts();
      if (json) throw new Error("--json not supported for long-running server.");

      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const creds = requireClientCreds(cfg, client);
      if (!cfg.webhookVerifyToken) {
        logger.warn("Missing webhook verify token. Run `waba webhook setup --url https://...` first.");
      }

      const api = new WhatsAppCloudApi({
        token: creds.token,
        phoneNumberId: creds.phoneNumberId,
        wabaId: creds.wabaId,
        graphVersion: cfg.graphVersion || "v20.0",
        baseUrl: cfg.baseUrl
      });

      const memoryEnabled = memory !== false;
      const memAppend = async (client, event) => {
        if (!memoryEnabled) return;
        await appendMemory(client, event);
      };

      if (opts.autoReply && !opts.allowOutbound) {
        logger.warn("--auto-reply set but --allow-outbound not set. Will NOT send outbound messages.");
      }

      const server = await createWebhookServer({
        port: opts.port,
        path: opts.path,
        verifyToken: cfg.webhookVerifyToken || "missing",
        appSecret: cfg.appSecret,
        onPost: async (payload) => {
          const messages = extractMessages(payload);
          const statuses = extractStatuses(payload);

          for (const s of statuses) logger.info(`status ${s.status} id=${s.id} to=${s.recipient_id || ""}`);

          for (const m of messages) {
            logger.info(`inbound from=${m.from} type=${m.type} id=${m.id}`);
            if (m.type === "text") {
              logger.info(`text: ${m.text}`);
              await memAppend(client, { type: "inbound_text", from: m.from, text: m.text, messageId: m.id });
            }

            if (m.type === "image" && m.image?.id) {
              logger.info(`image id=${m.image.id} mime=${m.image.mime_type || ""}`);
              try {
                const meta = await api.getMedia({ mediaId: m.image.id });
                const buf = await api.downloadMedia({ url: meta.url });
                await memAppend(client, { type: "inbound_image", from: m.from, mediaId: m.image.id, meta });
                if (cfg.openaiApiKey) {
                  const desc = await visionDescribe(cfg, { imageBuffer: buf, mimeType: meta.mime_type || "image/jpeg" });
                  logger.info(`vision: ${desc}`);
                  await memAppend(client, { type: "vision_description", from: m.from, mediaId: m.image.id, desc });
                } else {
                  logger.warn("OPENAI_API_KEY not set; skipping vision description.");
                }
              } catch (err) {
                logger.error(`image handling failed: ${err?.message || err}`);
              }
            }

            if (m.type === "audio" && m.audio?.id) {
              logger.info(`audio id=${m.audio.id} mime=${m.audio.mime_type || ""}`);
              try {
                const meta = await api.getMedia({ mediaId: m.audio.id });
                const buf = await api.downloadMedia({ url: meta.url });
                const tmp = path.join(os.tmpdir(), `waba_audio_${Date.now()}.bin`);
                await fs.writeFile(tmp, buf);
                await memAppend(client, { type: "inbound_audio", from: m.from, mediaId: m.audio.id, meta, tmp });
                if (cfg.openaiApiKey) {
                  const text = await transcribeAudioFile(cfg, { filePath: tmp, mimeType: meta.mime_type || "audio/ogg" });
                  logger.info(`transcript: ${text}`);
                  await memAppend(client, { type: "audio_transcript", from: m.from, mediaId: m.audio.id, text });
                } else {
                  logger.warn("OPENAI_API_KEY not set; skipping transcription.");
                }
              } catch (err) {
                logger.error(`audio handling failed: ${err?.message || err}`);
              }
            }

            if (opts.autoClassify && m.type === "text" && m.text) {
              // Lightweight auto-suggestion only (no outbound sends).
              try {
                const { createAgentContext } = require("../lib/agent/agent");
                const { planSteps } = require("../lib/agent/planner");
                const { executePlan } = require("../lib/agent/executor");
                const ctx = await createAgentContext({ client });
                // Build a 1-step plan to classify.
                const plan = await planSteps(ctx, {
                  prompt: "classify inbound lead",
                  client,
                  exampleInboundText: m.text
                });
                const classifyStep = plan.steps.find((s) => s.tool === "lead.classify");
                if (!classifyStep) return;
                const res = await executePlan(ctx, { steps: [classifyStep], risk: "medium" }, { yes: true, allowHighRisk: false, json: false });
                const out = res.results?.[0]?.out?.result;
                if (out?.nextReplyHindi || out?.nextReplyEnglish) {
                  const reply = containsHindi(m.text) ? out.nextReplyHindi : out.nextReplyEnglish;
                  if (reply) logger.info(`suggested reply: ${reply}`);
                }
              } catch (err) {
                logger.error(`auto-classify failed: ${err?.message || err}`);
              }
            }

            if (opts.autoReply && opts.allowOutbound && m.type === "text" && m.text) {
              try {
                const { toolLeadClassify } = require("../lib/tools/builtins/tool-lead-classify");
                const tool = toolLeadClassify();
                const ctx = { config: cfg, client, appendMemory: memAppend };
                const out = await tool.execute(ctx, { client, from: m.from, text: m.text });
                const r = out?.result || {};
                const reply = containsHindi(m.text) ? (r.nextReplyHindi || r.nextReplyEnglish) : (r.nextReplyEnglish || r.nextReplyHindi);
                const body = reply || "Thanks for messaging. Please share your name and requirement, and we'll get back shortly.";
                logger.warn("Auto-reply sending outbound text (may incur per-message fees).");
                const sent = await api.sendText({ to: m.from, body });
                await memAppend(client, { type: "auto_reply_sent", to: m.from, body, sent });
                logger.ok(`auto-replied to ${m.from}`);
              } catch (err) {
                logger.error(`auto-reply failed: ${err?.message || err}`);
              }
            }
          }
        }
      });

      logger.ok(`Webhook server listening on http://localhost:${opts.port}${opts.path}`);
      logger.info("Meta callback must be publicly reachable (use ngrok / cloud). Ctrl+C to stop.");

      // Keep process alive.
      server.on("close", () => logger.warn("server closed"));
    });

  w.command("start")
    .description("start an Express webhook receiver (recommended)")
    .option("--host <host>", "bind host (default: 127.0.0.1; use 0.0.0.0 for containers)", "127.0.0.1")
    .option("--port <n>", "port", (v) => Number(v), 3000)
    .option("--path <path>", "path (default: /webhook)", "/webhook")
    .option("--client <name>", "client name (memory + config). Default: active client")
    .option("--ngrok", "start an ngrok tunnel (requires ngrok + auth token)", false)
    .option("--verbose", "log full webhook payloads (PII redacted)", false)
    .option("--llm", "use LLM (if configured) for lead classification + reply suggestion", false)
    .option("--allow-outbound", "allow outbound replies from webhook flow (still prompts for confirmation)", false)
    .option("--allow-high-risk", "allow high-risk outbound tools without extra prompts (use only for trusted production configs)", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json, memory } = root.opts();
      if (json) throw new Error("--json not supported for long-running server.");

      const cfg = await getConfig();
      if (!cfg.webhookVerifyToken) {
        logger.warn("Missing webhook verify token. Run `waba webhook setup --url https://...` first.");
      }

      await startWebhookServer({
        host: opts.host,
        port: opts.port,
        pathName: opts.path,
        verifyToken: cfg.webhookVerifyToken,
        appSecret: cfg.appSecret,
        client: opts.client || cfg.activeClient || "default",
        verbose: !!opts.verbose,
        allowOutbound: !!opts.allowOutbound,
        allowHighRisk: !!opts.allowHighRisk,
        memoryEnabled: memory !== false,
        enableNgrok: !!opts.ngrok,
        llm: !!opts.llm
      });
    });

  w.command("validate")
    .description("validate a webhook endpoint by calling hub.challenge (GET)")
    .requiredOption("--url <url>", "full webhook URL, example: https://your.app/webhook")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json, memory } = root.opts();
      const cfg = await getConfig();
      const { toolWebhookValidate } = require("../lib/tools/builtins/tool-webhook-validate");
      const tool = toolWebhookValidate();
      const memAppend = async (client, event) => {
        if (memory === false) return;
        await appendMemory(client, event);
      };
      const ctx = { config: cfg, client: "default", appendMemory: memAppend, memoryEnabled: memory !== false };
      const out = await tool.execute(ctx, { url: opts.url });
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, out }, null, 2));
        return;
      }
      if (out.ok) logger.ok(`Webhook verify OK (HTTP ${out.status})`);
      else logger.error(`Webhook verify FAILED (HTTP ${out.status}) body=${String(out.body).trim()}`);
    });

  w.command("test")
    .description("simulate an inbound webhook POST to a target URL")
    .option("--target <url>", "target webhook URL, example: http://localhost:3000/webhook", "http://localhost:3000/webhook")
    .option("--from <wa_id>", "from number (example: 9199...)", "919999999999")
    .option("--text <body>", "text body", "Hi, price please")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();

      const payload = sampleTextInbound({ from: opts.from, body: opts.text });
      const res = await fetch(opts.target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const text = await res.text();

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: res.ok, status: res.status, body: text }, null, 2));
        return;
      }
      logger.ok(`POST ${opts.target} -> ${res.status}`);
      if (text) logger.info(text);
    });
}

module.exports = { registerWebhookCommands };
