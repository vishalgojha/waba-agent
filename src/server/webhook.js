const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs-extra");
const path = require("path");
const dayjs = require("dayjs");

const { logger } = require("../lib/logger");
const { verifyHubSignature256 } = require("../lib/webhook/signature");
const { parseWebhookPayload, ruleBasedIntent } = require("../lib/message-parser");
const { describeImageStub, transcribeVoiceStub } = require("../lib/multimodal-stubs");
const { createAgentContext } = require("../lib/agent/agent");
const { executePlan } = require("../lib/agent/executor");
const { contextDir, wabaHome } = require("../lib/paths");
const { safeName } = require("../lib/memory");
const { addOptout, isOptedOut } = require("../lib/optout-store");
const { handleInboundWithFlow } = require("../lib/flow-engine");
const { getClientConfig } = require("../lib/client-config");
const { hasAnyCrm, pushLeadToCrm } = require("../lib/crm");

function redactPhone(s) {
  const t = String(s || "");
  if (t.length <= 6) return "***";
  return `${t.slice(0, 2)}***${t.slice(-4)}`;
}

function redactPayload(payload) {
  // Best-effort: keep structure for debugging while masking PII.
  const p = JSON.parse(JSON.stringify(payload || {}));
  try {
    for (const entry of p.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        if (v.contacts) {
          for (const c of v.contacts) {
            if (c.wa_id) c.wa_id = redactPhone(c.wa_id);
            if (c.profile?.name) c.profile.name = "[redacted]";
          }
        }
        if (v.messages) {
          for (const m of v.messages) {
            if (m.from) m.from = redactPhone(m.from);
            // Keep message type + ids, but do not leak contents in verbose logs by default.
          }
        }
        if (v.statuses) {
          for (const s of v.statuses) {
            if (s.recipient_id) s.recipient_id = redactPhone(s.recipient_id);
          }
        }
      }
    }
  } catch {}
  return p;
}

async function readClientConfig(client) {
  // Backward-compatible helper; prefer getClientConfig.
  return getClientConfig(client);
}

function in24hWindow(lastInboundIso, nowIso) {
  if (!lastInboundIso) return false;
  const last = dayjs(lastInboundIso);
  const now = dayjs(nowIso);
  if (!last.isValid() || !now.isValid()) return false;
  return now.diff(last, "hour", true) <= 24;
}

function buildReplyPlan({ ctx, clientCfg, from, intent, sessionOpen, textForReply, replyOverride }) {
  const replies = clientCfg?.intentReplies || {};
  const templates = clientCfg?.templates || {};

  let body = replyOverride || null;
  if (!body) {
    body =
      intent === "greeting"
        ? replies.greeting
        : intent === "price_inquiry"
          ? replies.price_inquiry
          : intent === "booking_request"
            ? replies.booking_request
            : intent === "order_intent"
              ? replies.order_intent
              : replies.fallback;
  }

  const steps = [
    {
      tool: "memory.note",
      args: { client: ctx.client, text: `Inbound intent=${intent} from=${redactPhone(from)} text=${String(textForReply || "").slice(0, 120)}` },
      reason: "Record inbound summary."
    }
  ];

  // Session awareness:
  // - If session is open, reply with text (safest for demos).
  // - If session is closed, prefer welcome template if configured; otherwise do not send.
  if (intent === "greeting" && templates?.welcome?.name) {
    steps.push({
      tool: "template.send",
      args: { to: from, templateName: templates.welcome.name, language: templates.welcome.language || "en", params: [] },
      reason: "Greeting: prefer welcome template if configured."
    });
  } else if (sessionOpen) {
    steps.push({
      tool: "message.send_text",
      args: { to: from, body: body || "Thanks for messaging. Please share your requirement." },
      reason: "Reply within the 24h customer-service window."
    });
  } else if (templates?.welcome?.name) {
    steps.push({
      tool: "template.send",
      args: { to: from, templateName: templates.welcome.name, language: templates.welcome.language || "en", params: [] },
      reason: "Session closed. Use pre-approved template."
    });
  } else {
    steps.push({
      tool: "memory.note",
      args: { client: ctx.client, text: "Session closed and no welcome template configured; skipping outbound reply." },
      reason: "Avoid violating WhatsApp outbound rules."
    });
  }

  return steps;
}

function isOptoutText(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  if (/^(stop|unsubscribe|cancel|dnd|opt\s*out|remove)\b/.test(t)) return true;
  if (/\b(stop|unsubscribe|dnd|do\s*not\s*message)\b/.test(t)) return true;
  return false;
}

function isCallRequestText(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  if (/\b(call\s*me|call\s*back|callback|please\s*call|ring\s*me)\b/.test(t)) return true;
  if (/\b(phone\s*call|talk\s*to\s*you|speak\s*to)\b/.test(t)) return true;
  return false;
}

function shouldNotify(clientCfg, event) {
  const notifyNumber = clientCfg?.handoff?.notifyNumber;
  if (!notifyNumber) return { ok: false, reason: "missing_notify_number" };
  const list = clientCfg?.handoff?.notifyOn;
  const allow = Array.isArray(list) ? list : ["flow_end", "handoff", "unknown_intent", "call_request"];
  return { ok: allow.includes(event), notifyNumber };
}

function buildStaffNotifyText({ client, from, intent, fields, text, reason }) {
  const lines = [
    `[${client}] Lead ${reason || "update"}`,
    `From: ${from}`,
    `Intent: ${intent || "unknown"}`,
    fields ? `Fields: ${JSON.stringify(fields)}` : null,
    text ? `Last: ${String(text).slice(0, 220)}` : null
  ].filter(Boolean);
  return lines.join("\n");
}

async function startWebhookServer({
  host = "127.0.0.1",
  port = 3000,
  pathName = "/webhook",
  verifyToken,
  appSecret,
  client = "default",
  verbose = false,
  allowOutbound = false,
  memoryEnabled = true,
  enableNgrok = false,
  llm = false
} = {}) {
  if (!verifyToken) logger.warn("Missing verify token (WABA_VERIFY_TOKEN or saved config). GET verification may fail.");

  const ctx = await createAgentContext({ client, memoryEnabled });

  // In-memory session store (per process) for quick 24h checks.
  const lastInboundByFrom = new Map(); // from -> ISO

  const app = express();

  app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

  app.get(pathName, (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token && challenge && verifyToken && token === verifyToken) {
      res.status(200).type("text/plain").send(String(challenge));
      return;
    }
    res.status(403).type("text/plain").send("Forbidden");
  });

  app.use(
    pathName,
    bodyParser.json({
      limit: "2mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );

  // Graceful handling of invalid JSON from clients/tests.
  // Note: Meta will send valid JSON; this is for local testing safety.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    logger.warn(`webhook parse error: ${err?.message || err}`);
    res.status(400).type("text/plain").send("Invalid JSON");
  });

  app.post(pathName, async (req, res) => {
    try {
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), "utf8");
      const sig = req.headers["x-hub-signature-256"];
      const v = verifyHubSignature256({ appSecret, rawBody, signatureHeader: sig });
      if (!v.ok) {
        res.status(401).type("text/plain").send("Bad signature");
        logger.warn(`webhook signature invalid: ${v.reason}`);
        return;
      }

      const payload = req.body;
      // ACK quickly after minimal validation.
      res.status(200).type("text/plain").send("OK");
      if (verbose) {
        logger.info({ webhook: redactPayload(payload) });
      }

      setImmediate(async () => {
        const events = parseWebhookPayload(payload);
        for (const e of events) {
          if (e.kind === "status") {
            logger.info(`status ${e.status} id=${e.id} to=${redactPhone(e.recipient_id || "")}`);
            await ctx.appendMemory(ctx.client, { type: "status_update", status: e.status, id: e.id, recipient: e.recipient_id, ts: e.timestamp });
            continue;
          }

          if (e.kind !== "message") continue;
          const from = e.from;
          const nowIso = new Date().toISOString();
          lastInboundByFrom.set(from, e.timestamp || nowIso);

          const summary = {
            id: e.id,
            from: redactPhone(from),
            type: e.type,
            ts: e.timestamp
          };
          logger.info(`inbound ${JSON.stringify(summary)}`);

          // Normalize a "text for classification" across types.
          let textForIntent = e.text || "";
          if (e.type === "interactive" && e.interactive) {
            textForIntent = e.interactive.title || e.interactive.id || "";
          }

          // Multimodal enrichment (stubs).
          let transcript = null;
          let imageDesc = null;
          if (e.type === "audio" && e.audio?.id) {
            try {
              const out = await transcribeVoiceStub(ctx, { mediaId: e.audio.id, mimeType: e.audio.mime_type });
              transcript = out.text;
              await ctx.appendMemory(ctx.client, { type: "inbound_audio", from, mediaId: e.audio.id, ts: e.timestamp, transcript, filePath: out.filePath });
              textForIntent = `${textForIntent}\n${transcript}`.trim();
            } catch (err) {
              logger.warn(`audio processing failed: ${err?.message || err}`);
              await ctx.appendMemory(ctx.client, { type: "inbound_audio", from, mediaId: e.audio.id, ts: e.timestamp, error: String(err?.message || err) });
            }
          }
          if (e.type === "image" && e.image?.id) {
            try {
              const out = await describeImageStub(ctx, { mediaId: e.image.id, mimeType: e.image.mime_type });
              imageDesc = out.desc;
              await ctx.appendMemory(ctx.client, { type: "inbound_image", from, mediaId: e.image.id, ts: e.timestamp, desc: imageDesc, filePath: out.filePath });
              textForIntent = `${textForIntent}\n${imageDesc}`.trim();
            } catch (err) {
              logger.warn(`image processing failed: ${err?.message || err}`);
              await ctx.appendMemory(ctx.client, { type: "inbound_image", from, mediaId: e.image.id, ts: e.timestamp, error: String(err?.message || err) });
            }
          }

          await ctx.appendMemory(ctx.client, { type: "inbound_message", from, ts: e.timestamp, msgType: e.type, text: e.text, interactive: e.interactive });

          const clientCfg = await readClientConfig(ctx.client);
          const rb = ruleBasedIntent(textForIntent || "");
          let intent = rb.intent;
          let replyOverride = null;

          // Compliance: auto-opt-out on STOP/UNSUBSCRIBE.
          if (isOptoutText(textForIntent)) {
            const already = await isOptedOut(ctx.client, from);
            await addOptout(ctx.client, from, { reason: "user-request", source: "inbound-stop" });
            await ctx.appendMemory(ctx.client, { type: "optout_added", from, already, ts: nowIso, text: textForIntent });
            logger.warn(`opt-out recorded for ${redactPhone(from)} (${ctx.client})`);
            // Do not auto-reply; outbound from server requires interactive confirmation.
            continue;
          }

          const callRequest = isCallRequestText(textForIntent);

          if (llm && ctx.config?.openaiApiKey && textForIntent) {
            try {
              const tool = ctx.registry.get("lead.classify");
              if (tool) {
                const out = await tool.execute(ctx, { client: ctx.client, text: textForIntent });
                const r = out?.result || {};
                if (r.intent) intent = r.intent;
                replyOverride = r.nextReplyEnglish || r.nextReplyHindi || null;
              }
            } catch (err) {
              logger.warn(`LLM classify failed, falling back to rules: ${err?.message || err}`);
            }
          }

          const last = lastInboundByFrom.get(from);
          const sessionOpen = in24hWindow(e.timestamp || last, nowIso);

          // Flow routing (premium): if configured, advance the flow and ask the next question.
          const flowName =
            clientCfg?.flows?.intentMap?.[intent] ||
            clientCfg?.flows?.active ||
            null;

          let steps = null;
          let flowRes = null;
          if (callRequest) {
            // Force human handoff.
            flowRes = {
              ok: true,
              flow: flowName,
              action: "handoff",
              message: { type: "text", body: "Sure. Our team will call you shortly. Please share your preferred time." },
              state: { data: null }
            };
            steps = [
              { tool: "memory.note", args: { client: ctx.client, text: `Call request from=${redactPhone(from)} intent=${intent}` }, reason: "Escalate to human." },
              { tool: "message.send_text", args: { to: from, body: flowRes.message.body, category: "utility" }, reason: "Acknowledge call request." }
            ];
          } else if (flowName) {
            flowRes = await handleInboundWithFlow({
              client: ctx.client,
              from,
              inboundText: textForIntent,
              flowName,
              nowIso
            });
            if (flowRes.ok && flowRes.message?.body) {
              steps = [
                {
                  tool: "memory.note",
                  args: { client: ctx.client, text: `Flow=${flowName} action=${flowRes.action} intent=${intent} from=${redactPhone(from)}` },
                  reason: "Record flow progression."
                },
                {
                  tool: "message.send_text",
                  args: { to: from, body: flowRes.message.body, category: "utility" },
                  reason: "Flow next step."
                }
              ];
            }
          }

          // Fallback: old intent reply plan.
          if (!steps) {
            steps = buildReplyPlan({
              ctx,
              clientCfg,
              from,
              intent,
              sessionOpen,
              textForReply: textForIntent,
              replyOverride
            }).filter(Boolean);
          }

          // CRM auto-push (sellable): push on flow completion by default.
          try {
            const autoMode = clientCfg?.integrations?.autoPush?.mode || "flow_end"; // flow_end|every_inbound
            const enabled = clientCfg?.integrations?.autoPush?.enabled;
            const shouldAuto = enabled === undefined ? hasAnyCrm(clientCfg?.integrations) : !!enabled;
            const flowCompleted = flowRes?.action === "end";
            const handoffCompleted = flowRes?.action === "handoff";
            const shouldPush = shouldAuto && (autoMode === "every_inbound" || (autoMode === "flow_end" && flowCompleted));
            if (shouldPush) {
              const lead = {
                event: flowCompleted ? "lead_qualified" : "lead_inbound",
                client: ctx.client,
                from,
                phone: from,
                intent,
                ts: nowIso,
                text: textForIntent,
                flow: flowName || null,
                fields: flowRes?.state?.data || null,
                multimodal: { transcript, imageDesc }
              };
              const out = await pushLeadToCrm({ client: ctx.client, clientCfg, lead });
              await ctx.appendMemory(ctx.client, { type: "crm_push", ok: out.ok, results: out.results, ts: nowIso, event: lead.event, from });
              if (!out.ok) logger.warn(`CRM push failed for ${redactPhone(from)}`);
            }
            // Always push handoff if integrations exist.
            if (shouldAuto && handoffCompleted) {
              const lead = {
                event: "lead_handoff",
                client: ctx.client,
                from,
                phone: from,
                intent,
                ts: nowIso,
                text: textForIntent,
                flow: flowName || null,
                fields: flowRes?.state?.data || null,
                multimodal: { transcript, imageDesc }
              };
              const out = await pushLeadToCrm({ client: ctx.client, clientCfg, lead });
              await ctx.appendMemory(ctx.client, { type: "crm_push", ok: out.ok, results: out.results, ts: nowIso, event: lead.event, from });
            }
          } catch (err) {
            logger.warn(`CRM push error: ${err?.message || err}`);
          }

          if (!allowOutbound) {
            // Remove outbound steps; still show plan via executor.
            const filtered = steps.filter((s) => s.tool !== "message.send_text" && s.tool !== "template.send");
            logger.warn("Outbound is disabled. Re-run with --allow-outbound to actually reply.");
            await executePlan(ctx, { steps: filtered, risk: "low" }, { yes: true, allowHighRisk: false, json: false });
            continue;
          }

          // Staff notify (WhatsApp) on flow end/handoff/unknown/call request.
          try {
            const staffEvent =
              callRequest ? "call_request" :
              flowRes?.action === "handoff" ? "handoff" :
              flowRes?.action === "end" ? "flow_end" :
              (intent === "unknown") ? "unknown_intent" :
              null;

            if (staffEvent) {
              const n = shouldNotify(clientCfg, staffEvent);
              if (n.ok) {
                const text = buildStaffNotifyText({
                  client: ctx.client,
                  from,
                  intent,
                  fields: flowRes?.state?.data || null,
                  text: textForIntent,
                  reason: staffEvent
                });
                steps.unshift({
                  tool: "message.send_text",
                  args: { to: n.notifyNumber, body: text, category: "utility", internal: true },
                  reason: "Notify staff."
                });
              }
            }
          } catch (err) {
            logger.warn(`notify error: ${err?.message || err}`);
          }

          // Tag cost category for auto-replies as utility by default.
          // (For marketing broadcasts, use campaign tooling instead.)
          for (const s of steps) {
          if (s.tool === "message.send_text" || s.tool === "template.send") {
            s.args = { ...(s.args || {}), category: s.args?.category || "utility" };
          }
        }

        const hasOutbound = steps.some((s) => s.tool === "message.send_text" || s.tool === "template.send");
        const overallRisk = hasOutbound ? "high" : "low";

          // Execute with confirmations. Even with --yes, high-risk steps should prompt unless allowHighRisk is set.
          await executePlan(ctx, { steps, risk: overallRisk }, { yes: true, allowHighRisk: false, json: false });
        }
      });
    } catch (err) {
      try {
        if (!res.headersSent) res.status(500).type("text/plain").send("Server error");
      } catch {}
      logger.error(err?.stack || String(err));
    }
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(port, host, () => resolve(s));
  });

  logger.ok(`Webhook server listening on http://${host}:${port}${pathName}`);
  logger.info(`WABA_HOME: ${wabaHome()}`);

  let publicUrl = null;
  if (enableNgrok) {
    try {
      // Requires `NGROK_AUTHTOKEN` (or ngrok account setup depending on version).
      // eslint-disable-next-line import/no-extraneous-dependencies
      const ngrok = require("ngrok");
      publicUrl = await ngrok.connect({ addr: port });
      logger.ok(`ngrok: ${publicUrl}`);
      logger.info(`Set Meta webhook callback URL to: ${publicUrl}${pathName}`);
    } catch (err) {
      logger.warn(`Failed to start ngrok. Install/configure ngrok and set NGROK_AUTHTOKEN. ${err?.message || err}`);
    }
  }

  return { server, publicUrl };
}

module.exports = { startWebhookServer };
