const dayjs = require("dayjs");

const { getConfig } = require("../lib/config");
const { readMemory } = require("../lib/memory");
const { logger } = require("../lib/logger");
const { askYesNo } = require("../lib/prompt");
const { getClientConfig } = require("../lib/client-config");
const { createAgentContext } = require("../lib/agent/agent");
const { in24hWindow } = require("../lib/session-window");

function redactPhone(s) {
  const t = String(s || "");
  const digits = t.replace(/\D/g, "");
  if (digits.length < 8) return "***";
  return `${digits.slice(0, 2)}***${digits.slice(-4)}`;
}

function parseDurationMs(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2] || "ms";
  if (!Number.isFinite(n) || n < 0) return null;
  if (u === "ms") return Math.floor(n);
  if (u === "s") return Math.floor(n * 1000);
  if (u === "m") return Math.floor(n * 60_000);
  if (u === "h") return Math.floor(n * 3_600_000);
  if (u === "d") return Math.floor(n * 86_400_000);
  return null;
}

function normalizeNumber(x) {
  const t = String(x || "").trim().replace(/^\+/, "");
  return t.replace(/[^0-9]/g, "");
}

function isInbound(e) {
  const t = String(e?.type || "");
  return t === "inbound_message" || t === "inbound_text" || t.startsWith("inbound_");
}

function isOutbound(e) {
  const t = String(e?.type || "");
  return t === "outbound_sent" || t === "auto_reply_sent" || t.startsWith("outbound_");
}

function isRecent(e, cutoffMs) {
  const ts = Date.parse(e?.ts || "");
  return Number.isFinite(ts) && ts >= cutoffMs;
}

function fmtAgeMinutes(tsIso) {
  const t = dayjs(tsIso);
  if (!t.isValid()) return null;
  const mins = dayjs().diff(t, "minute", true);
  return Math.max(0, Math.round(mins));
}

function lastTextSnippet(e) {
  const s = String(e?.text || e?.body || "");
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > 140 ? `${t.slice(0, 140)}...` : t;
}

async function getMissedLeadsInternal({ client, sinceMs, minAgeMs, limit }) {
  const now = Date.now();
  const cutoff = now - sinceMs;
  const minInboundTs = now - minAgeMs;

  const events = await readMemory(client, { limit: 50_000 });
  const recent = events.filter((e) => isRecent(e, cutoff));

  // Aggregate per number.
  const by = new Map(); // from -> { lastInboundAt, lastOutboundAt, lastInboundEvent }
  for (const e of recent) {
    if (isInbound(e)) {
      const from = normalizeNumber(e.from);
      if (!from) continue;
      const ts = Date.parse(e.ts || "");
      if (!Number.isFinite(ts)) continue;
      const prev = by.get(from) || { from, lastInboundAt: null, lastOutboundAt: null, lastInboundEvent: null };
      if (!prev.lastInboundAt || ts > Date.parse(prev.lastInboundAt)) {
        prev.lastInboundAt = new Date(ts).toISOString();
        prev.lastInboundEvent = e;
      }
      by.set(from, prev);
    } else if (isOutbound(e)) {
      const to = normalizeNumber(e.to || e.recipient || e.to_number);
      if (!to) continue;
      const ts = Date.parse(e.ts || "");
      if (!Number.isFinite(ts)) continue;
      const prev = by.get(to) || { from: to, lastInboundAt: null, lastOutboundAt: null, lastInboundEvent: null };
      if (!prev.lastOutboundAt || ts > Date.parse(prev.lastOutboundAt)) {
        prev.lastOutboundAt = new Date(ts).toISOString();
      }
      by.set(to, prev);
    }
  }

  let missed = [];
  for (const x of by.values()) {
    if (!x.lastInboundAt) continue;
    const inboundTs = Date.parse(x.lastInboundAt);
    if (!Number.isFinite(inboundTs) || inboundTs > now) continue;
    if (inboundTs > minInboundTs) continue; // too fresh
    const outboundTs = x.lastOutboundAt ? Date.parse(x.lastOutboundAt) : NaN;
    const okOutbound = Number.isFinite(outboundTs) && outboundTs >= inboundTs;
    if (okOutbound) continue;
    missed.push(x);
  }

  missed.sort((a, b) => Date.parse(b.lastInboundAt) - Date.parse(a.lastInboundAt));
  missed = missed.slice(0, Math.max(1, Math.min(500, Number(limit) || 50)));

  return missed;
}

function renderTextTemplate(tpl, vars) {
  let out = String(tpl || "");
  const v = vars && typeof vars === "object" ? vars : {};
  out = out.replace(/\{\{\s*([a-zA-Z0-9._-]+)\s*\}\}/g, (_m, key) => {
    const val = v[key];
    if (val === null || val === undefined) return "";
    return String(val);
  });
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function registerLeadsCommands(program) {
  const l = program.command("leads").description("lead ops helpers (missed leads, follow-ups)");

  l.command("missed")
    .description("list inbound leads that have no outbound response after the last inbound message")
    .option("--client <name>", "client name (default: active client)")
    .option("--since <dur>", "lookback window (default: 24h)", "24h")
    .option("--min-age <dur>", "ignore very recent inbound (default: 5m)", "5m")
    .option("--limit <n>", "max leads", (v) => Number(v), 50)
    .option("--no-redact", "do not redact phone numbers (not recommended)", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      const sinceMs = parseDurationMs(opts.since);
      const minAgeMs = parseDurationMs(opts.minAge);
      if (!sinceMs) throw new Error("Invalid --since. Example: 24h, 2d, 90m");
      if (!minAgeMs) throw new Error("Invalid --min-age. Example: 5m, 30s");

      const missed = await getMissedLeadsInternal({
        client,
        sinceMs,
        minAgeMs,
        limit: opts.limit
      });

      const out = missed.map((x) => {
        const fromRaw = x.from;
        return {
          from: opts.redact === false ? fromRaw : redactPhone(fromRaw),
          lastInboundAt: x.lastInboundAt,
          ageMinutes: fmtAgeMinutes(x.lastInboundAt),
          lastInboundType: x.lastInboundEvent?.msgType || x.lastInboundEvent?.type || null,
          lastText: lastTextSnippet(x.lastInboundEvent)
        };
      });

      const result = {
        client,
        window: { since: opts.since, minAge: opts.minAge },
        count: out.length,
        leads: out
      };

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, result }, null, 2));
        return;
      }

      logger.info(`Missed leads (${client}): ${out.length}`);
      for (const r of out) {
        logger.info(`${r.from} age=${r.ageMinutes}m inbound=${r.lastInboundAt} text="${r.lastText}"`);
      }
      logger.info("Tip: use templates/campaigns for follow-ups outside the 24h window.");
    });

  l.command("followup")
    .description("follow up missed leads with a compliant message (plan/send/schedule)")
    .option("--client <name>", "client name (default: active client)")
    .option("--mode <plan|send|schedule>", "default: plan", "plan")
    .option("--since <dur>", "lookback window (default: 7d)", "7d")
    .option("--min-age <dur>", "ignore very recent inbound (default: 10m)", "10m")
    .option("--limit <n>", "max leads", (v) => Number(v), 25)
    .option("--throttle-ms <n>", "delay between sends (send mode)", (v) => Number(v), 600)
    .option("--yes", "skip confirmation prompt", false)
    .option("--text <text>", "text reply to use for 24h window (supports {{client}}, {{from}}, {{snippet}})")
    .option("--template-name <name>", "approved follow-up template name (required for outside 24h)")
    .option("--template-language <code>", "template language code", "en")
    .option("--template-params <json>", "template params JSON (array/object)", null)
    .option("--schedule-delay <dur>", "for schedule mode: delay from now (default: 0m)", "0m")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      if (json) throw new Error("--json not supported for followup (it can send messages).");

      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      const sinceMs = parseDurationMs(opts.since);
      const minAgeMs = parseDurationMs(opts.minAge);
      if (!sinceMs) throw new Error("Invalid --since. Example: 24h, 2d, 90m");
      if (!minAgeMs) throw new Error("Invalid --min-age. Example: 5m, 30s");

      const mode = String(opts.mode || "plan").toLowerCase();
      if (!["plan", "send", "schedule"].includes(mode)) throw new Error("Invalid --mode. Use plan|send|schedule.");

      const missed = await getMissedLeadsInternal({
        client,
        sinceMs,
        minAgeMs,
        limit: opts.limit
      });

      const clientCfg = (await getClientConfig(client)) || {};
      const followupTmplCfg = clientCfg?.templates?.followup || null;

      const templateName = opts.templateName || followupTmplCfg?.name || null;
      const templateLanguage = opts.templateLanguage || followupTmplCfg?.language || "en";

      let templateParams = null;
      if (opts.templateParams) {
        try {
          templateParams = JSON.parse(opts.templateParams);
        } catch (err) {
          throw new Error(`Invalid --template-params JSON: ${err?.message || err}`);
        }
      } else if (followupTmplCfg?.params) {
        templateParams = followupTmplCfg.params;
      }

      const defaultText =
        "Hi! Just following up on your message to {{client}}. Reply with your requirement and preferred time. If you want a call, reply CALL.";
      const textTpl = opts.text || clientCfg?.intentReplies?.fallback || defaultText;

      const nowIso = new Date().toISOString();
      const actions = [];
      let willText = 0;
      let willTemplate = 0;
      let skipped = 0;

      for (const x of missed) {
        const from = x.from;
        const lastInboundAt = x.lastInboundAt;
        const snippet = lastTextSnippet(x.lastInboundEvent);
        const sessionOpen = in24hWindow(lastInboundAt, nowIso);

        if (sessionOpen) {
          const body = renderTextTemplate(textTpl, { client, from, snippet });
          actions.push({ kind: "text", to: from, body, lastInboundAt });
          willText += 1;
        } else if (templateName) {
          const params = templateParams ?? ["there", client];
          actions.push({
            kind: "template",
            to: from,
            templateName,
            language: templateLanguage,
            params,
            lastInboundAt
          });
          willTemplate += 1;
        } else {
          actions.push({ kind: "skip", to: from, reason: "session_closed_no_template", lastInboundAt });
          skipped += 1;
        }
      }

      logger.warn("High risk: follow-ups are outbound and per-message billed. Ensure consent and opt-out handling.");
      logger.info(`Missed leads: ${missed.length} (text=${willText}, template=${willTemplate}, skipped=${skipped})`);

      for (const a of actions.slice(0, 20)) {
        if (a.kind === "text") logger.info(`${redactPhone(a.to)} -> text (24h ok)`);
        else if (a.kind === "template") logger.info(`${redactPhone(a.to)} -> template ${a.templateName}`);
        else logger.info(`${redactPhone(a.to)} -> skip (${a.reason})`);
      }
      if (actions.length > 20) logger.info(`... (${actions.length - 20} more)`);

      if (mode === "plan") {
        logger.info("Mode=plan. Re-run with --mode send or --mode schedule to take action.");
        if (!templateName) {
          logger.info("Tip: set per-client follow-up template:");
          logger.info(`- Edit ~/.waba/context/${client}/client.json -> templates.followup.name`);
          logger.info(`- Or pass --template-name <approved_template_name>`);
        }
        return;
      }

      if (!actions.length) {
        logger.info("Nothing to do.");
        return;
      }

      if (!opts.yes) {
        const ok = await askYesNo(`Proceed with mode=${mode} for ${actions.length} lead(s)?`, { defaultYes: false });
        if (!ok) return;
      }

      const ctx = await createAgentContext({ client, memoryEnabled: root.opts().memory !== false });

      if (mode === "schedule") {
        const delayMs = parseDurationMs(opts.scheduleDelay);
        if (delayMs == null) throw new Error("Invalid --schedule-delay. Example: 0m, 10m, 2h");
        const runAt = dayjs().add(delayMs, "millisecond").toISOString();

        let scheduled = 0;
        let skippedCount = 0;
        for (const a of actions) {
          try {
            if (a.kind === "text") {
              await ctx.registry.get("schedule.add_text").execute(ctx, { to: a.to, body: a.body, runAt });
              scheduled += 1;
            } else if (a.kind === "template") {
              await ctx.registry.get("schedule.add_template").execute(ctx, {
                to: a.to,
                templateName: a.templateName,
                language: a.language,
                params: a.params,
                category: "utility",
                runAt
              });
              scheduled += 1;
            } else {
              skippedCount += 1;
            }
          } catch (err) {
            logger.error(`schedule failed for ${redactPhone(a.to)}: ${err?.message || err}`);
          }
        }
        logger.ok(`Scheduled: ${scheduled}, skipped: ${skippedCount}`);
        logger.info("Next: `waba schedule run` (or run it via cron).");
        return;
      }

      // mode=send
      const throttleMs = Math.max(0, Math.min(60_000, Number(opts.throttleMs) || 0));
      let sent = 0;
      let failed = 0;
      let skippedCount = 0;

      for (const a of actions) {
        if (a.kind === "skip") {
          skippedCount += 1;
          continue;
        }
        try {
          if (a.kind === "text") {
            await ctx.registry.get("message.send_text").execute(ctx, { to: a.to, body: a.body, category: "utility" });
          } else if (a.kind === "template") {
            await ctx.registry.get("template.send").execute(ctx, {
              to: a.to,
              templateName: a.templateName,
              language: a.language,
              params: a.params,
              category: "utility"
            });
          }
          sent += 1;
        } catch (err) {
          failed += 1;
          logger.error(`send failed for ${redactPhone(a.to)}: ${err?.message || err}`);
        }

        if (throttleMs) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(throttleMs);
        }
      }

      logger.ok(`Sent: ${sent}, failed: ${failed}, skipped: ${skippedCount}`);
    });
}

module.exports = { registerLeadsCommands };
