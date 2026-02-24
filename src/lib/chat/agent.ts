// @ts-nocheck
const chalkImport = require("chalk");
const chalk = chalkImport.default || chalkImport;
const dayjs = require("dayjs");

const { getConfig } = require("../config");
const { getClientConfig } = require("../client-config");
const { createAgentContext } = require("../agent/agent");
const { chatCompletionJson, hasAiProviderConfigured } = require("../ai/openai");
const { readMemory } = require("../memory");
const { logger } = require("../logger");
const { safeClientName } = require("../creds");
const {
  isResaleMagicEnabled,
  getResaleSystemPrompt,
  extractResaleLeadProfile,
  detectResaleIntent,
  detectLanguageFromText,
  isResaleScopeInput,
  loadResaleFewShot
} = require("../domain/real-estate-resale");
const { buildSystemPrompt, buildUserPrompt } = require("./prompt");
const { LeadHandler, parseLanguageIntent, normalizePhone } = require("./lead-handler");
const { ProactiveScheduler } = require("./scheduler");

function safeJsonParse(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((a) => ({
      tool: String(a?.tool || "").trim(),
      params: a?.params && typeof a.params === "object" ? a.params : {},
      description: String(a?.description || "Execute action")
    }))
    .filter((a) => !!a.tool);
}

function fallbackResponse(message, suggestions = []) {
  return {
    message: String(message || "I can help with sends, templates, scheduling, and lead follow-ups."),
    actions: [],
    suggestions: Array.isArray(suggestions) ? suggestions : [],
    needsInput: false
  };
}

const RESALE_ALLOWED_TOOLS = new Set([
  "template.send",
  "message.send_text_buttons",
  "lead.schedule_followup",
  "lead.tag",
  "lead.escalate_human"
]);

function normalizeResaleActions(actions) {
  const out = [];
  for (const a of actions || []) {
    const tool = String(a?.tool || "").trim();
    const params = a?.params && typeof a.params === "object" ? { ...a.params } : {};
    const description = String(a?.description || "Execute resale action");
    if (!tool) continue;

    if (RESALE_ALLOWED_TOOLS.has(tool)) {
      out.push({ tool, params, description });
      continue;
    }

    if (tool === "message.send_text") {
      out.push({
        tool: "message.send_text_buttons",
        params: {
          to: params.to,
          body: params.body,
          buttons: Array.isArray(params.buttons) && params.buttons.length
            ? params.buttons
            : [{ id: "yes", title: "Yes" }, { id: "no", title: "No" }]
        },
        description
      });
      continue;
    }

    if (tool === "schedule.add_text" || tool === "schedule.add_template") {
      out.push({
        tool: "lead.schedule_followup",
        params: {
          to: params.to,
          days: 1,
          templateName: params.templateName,
          language: params.language,
          params: params.params
        },
        description
      });
    }
  }
  return out;
}

function getAiSetupHint(language = "en") {
  if (language === "hi") {
    return [
      "Full AI mode ke liye ek provider set karein:",
      "[Ollama local default, 16GB RAM friendly]",
      "1) ollama pull deepseek-coder-v2:16b",
      "2) ollama pull qwen2.5:7b",
      "3) ollama serve",
      "4) PowerShell: $env:OPENAI_BASE_URL=\"http://127.0.0.1:11434/v1\"",
      "5) PowerShell: $env:WABA_OPENAI_MODEL=\"deepseek-coder-v2:16b\"",
      "6) (optional) PowerShell: $env:OPENAI_API_KEY=\"ollama\"",
      "[Anthropic]",
      "7) PowerShell: $env:WABA_AI_PROVIDER=\"anthropic\"",
      "8) PowerShell: $env:ANTHROPIC_API_KEY=\"<key>\"",
      "9) PowerShell: $env:WABA_ANTHROPIC_MODEL=\"claude-3-5-haiku-latest\"",
      "[xAI / Grok]",
      "10) PowerShell: $env:WABA_AI_PROVIDER=\"xai\"",
      "11) PowerShell: $env:XAI_API_KEY=\"<key>\"",
      "12) PowerShell: $env:WABA_XAI_MODEL=\"grok-2-latest\"",
      "[OpenRouter]",
      "13) PowerShell: $env:WABA_AI_PROVIDER=\"openrouter\"",
      "14) PowerShell: $env:OPENROUTER_API_KEY=\"<key>\"",
      "15) PowerShell: $env:WABA_OPENROUTER_MODEL=\"openai/gpt-4o-mini\"",
      "16) waba chat ya waba gw restart karein."
    ].join("\n");
  }
  return [
    "For full AI mode, configure one provider:",
    "[Ollama local default, 16GB RAM friendly]",
    "1) ollama pull deepseek-coder-v2:16b",
    "2) ollama pull qwen2.5:7b",
    "3) ollama serve",
    "4) PowerShell: $env:OPENAI_BASE_URL=\"http://127.0.0.1:11434/v1\"",
    "5) PowerShell: $env:WABA_OPENAI_MODEL=\"deepseek-coder-v2:16b\"",
    "6) (optional) PowerShell: $env:OPENAI_API_KEY=\"ollama\"",
    "[Anthropic]",
    "7) PowerShell: $env:WABA_AI_PROVIDER=\"anthropic\"",
    "8) PowerShell: $env:ANTHROPIC_API_KEY=\"<key>\"",
    "9) PowerShell: $env:WABA_ANTHROPIC_MODEL=\"claude-3-5-haiku-latest\"",
    "[xAI / Grok]",
    "10) PowerShell: $env:WABA_AI_PROVIDER=\"xai\"",
    "11) PowerShell: $env:XAI_API_KEY=\"<key>\"",
    "12) PowerShell: $env:WABA_XAI_MODEL=\"grok-2-latest\"",
    "[OpenRouter]",
    "13) PowerShell: $env:WABA_AI_PROVIDER=\"openrouter\"",
    "14) PowerShell: $env:OPENROUTER_API_KEY=\"<key>\"",
    "15) PowerShell: $env:WABA_OPENROUTER_MODEL=\"openai/gpt-4o-mini\"",
    "16) Restart waba chat or waba gw."
  ].join("\n");
}

class WhatsAppAgent {
  constructor(context) {
    this.context = context;
    this.runtimeCtx = null;
    this.config = null;
    this.clientCfg = null;
    this.resaleMagicMode = false;
    this.resaleSystemPrompt = "";
    this.resaleFewShot = [];
    this.leadHandler = new LeadHandler(context);
    this.scheduler = null;
  }

  async init() {
    this.config = await getConfig();
    this.clientCfg = (await getClientConfig(this.context.client || this.config.activeClient || "default")) || {};
    this.resaleMagicMode = isResaleMagicEnabled(this.clientCfg);
    if (this.resaleMagicMode) {
      this.resaleSystemPrompt = await getResaleSystemPrompt();
      this.resaleFewShot = await loadResaleFewShot();
    }
    this.runtimeCtx = await createAgentContext({ client: this.context.client || this.config.activeClient || "default", memoryEnabled: true });
    this.scheduler = new ProactiveScheduler(this.context, this.runtimeCtx);
    return this;
  }

  async refreshLeadCache() {
    const client = safeClientName(this.context.client || this.config?.activeClient || "default");
    const events = await readMemory(client, { limit: 1000 });
    const leadsByPhone = new Map();
    for (const e of events) {
      const from = normalizePhone(e?.from);
      if (!from) continue;
      const current = leadsByPhone.get(from) || {
        phone: from,
        name: null,
        status: "active",
        source: "inbound",
        lastContactAt: e.ts || new Date().toISOString()
      };
      current.lastContactAt = e.ts || current.lastContactAt;
      if (e.type === "lead_classification") current.status = "qualified";
      leadsByPhone.set(from, current);
    }
    this.context.setLeads([...leadsByPhone.values()].slice(-200));
    const sentToday = events.filter((e) => {
      if (e.type !== "outbound_sent") return false;
      const ts = dayjs(e.ts || "");
      return ts.isValid() && ts.isAfter(dayjs().startOf("day"));
    }).length;
    const inbound = events.filter((e) => String(e.type || "").startsWith("inbound_")).length;
    const outbound = events.filter((e) => e.type === "outbound_sent").length;
    const responseRate = outbound > 0 ? (inbound / outbound) * 100 : 0;
    this.context.meta.messagesSentToday = sentToday;
    this.context.setStatusMetrics({
      activeConversations: this.context.getActiveLeadsCount(),
      responseRate: Number(responseRate.toFixed(1))
    });
  }

  getGreeting() {
    const h = new Date().getHours();
    const base = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    if (this.resaleMagicMode) {
      if (this.context.language === "hi") {
        return `${base}. Resale Magic Mode active hai. Main budget, BHK, area, timeline, brochure aur site-visit follow-ups handle kar sakta hoon.`;
      }
      return `${base}. Resale Magic Mode is active. I can handle budget/BHK/area/timeline qualification, brochure nudges, and site-visit follow-ups.`;
    }
    if (this.context.language === "hi") {
      if (this.context.client) return `${base}. Main ${this.context.client} ke saath help karne ke liye ready hoon.`;
      return `${base}. Main aapka WhatsApp business assistant hoon.`;
    }
    if (this.context.client) return `${base}. Ready to continue with ${this.context.client}.`;
    return `${base}. I am your WhatsApp Business assistant.`;
  }

  async process(userInput) {
    if (!this.runtimeCtx) await this.init();

    const autoLang = detectLanguageFromText(userInput);
    if (autoLang && autoLang !== this.context.language) this.context.setLanguage(autoLang);

    const langIntent = parseLanguageIntent(userInput);
    if (langIntent) {
      this.context.setLanguage(langIntent);
      return fallbackResponse(
        langIntent === "hi"
          ? "Theek hai, ab main Hindi-English mix mein reply karunga."
          : "Sure, I will continue in English.",
        ["Send welcome message", "Show pending follow-ups"]
      );
    }

    if (this.resaleMagicMode) {
      if (!isResaleScopeInput(userInput)) {
        const msg = this.context.language === "hi"
          ? "Main sirf real-estate resale leads ke liye optimized hoon. Budget, BHK, area, timeline, brochure ya site visit related query bhejiye."
          : "I am currently scoped to real-estate resale only. Please ask about budget, BHK, area, timeline, brochure, or site visit.";
        this.context.addMessage("agent", msg);
        return fallbackResponse(msg, [
          "2 BHK in Wakad under 80L",
          "Brochure bhejo",
          "Site visit this weekend"
        ]);
      }
      if (/\b(token|payment|transfer|agreement|legal|registry|stamp duty|external api|api call)\b/i.test(String(userInput || ""))) {
        const msg = this.context.language === "hi"
          ? "यह request high-risk category में है (money/legal/external action). मैं इसे human broker escalation queue में डाल रहा हूँ, approval के बाद ही execute होगा।"
          : "This request is high-risk (money/legal/external action). I will queue human escalation and execute only after approval.";
        this.context.addMessage("agent", msg);
        return {
          message: msg,
          actions: [{
            tool: "lead.escalate_human",
            params: {
              phone: this.context.meta?.phone || this.context.meta?.resaleLeadProfile?.phone || "",
              reason: "money_legal_external_request",
              priority: "high",
              note: String(userInput || "").slice(0, 280)
            },
            description: "Escalate high-risk conversation to human"
          }],
          suggestions: ["Escalate to broker", "Ask for safer next step"],
          needsInput: false
        };
      }
      const prev = this.context.meta?.resaleLeadProfile || {};
      const extracted = extractResaleLeadProfile(userInput, prev);
      if (extracted.changed) {
        this.context.meta.resaleLeadProfile = extracted.profile;
        await this.appendAuditEvent({
          type: "lead_profile_update",
          phone: this.context.meta?.phone || null,
          profile: extracted.profile
        });
      }
      const intent = detectResaleIntent(userInput);
      if (intent) {
        await this.appendAuditEvent({
          type: "resale_intent_detected",
          phone: this.context.meta?.phone || null,
          intent
        });
      }
    }

    const heuristic = this.leadHandler.heuristic(userInput);
    if (heuristic) {
      this.context.addMessage("agent", heuristic.message);
      return heuristic;
    }

    await this.refreshLeadCache();
    const history = this.context.getHistory(14);
    const sys = buildSystemPrompt({
      client: this.context.client,
      language: this.context.language,
      context: this.context.getRecentActivity(12),
      domainProfile: this.resaleMagicMode ? { vertical: "real-estate-resale" } : null,
      domainPrompt: this.resaleMagicMode
        ? `${this.resaleSystemPrompt}\nFew-shot:\n${JSON.stringify(this.resaleFewShot).slice(0, 4000)}`
        : ""
    });
    const user = buildUserPrompt({
      userInput,
      history,
      activeLeads: this.context.getActiveLeadsCount(),
      scheduledCount: this.context.getScheduledCount(),
      recentActivity: this.context.getRecentActivity(8)
    });

    const modelAvailable = hasAiProviderConfigured(this.config || {});
    if (!modelAvailable) {
      const direct = this.heuristicParse(userInput, null);
      if (direct) {
        const prefix = this.context.language === "hi"
          ? "AI provider unavailable hai. Direct command mode active."
          : "AI provider unavailable. Direct command mode is active.";
        const msg = `${prefix} ${direct.message}`.trim();
        this.context.addMessage("agent", msg);
        return {
          ...direct,
          message: msg
        };
      }
      const proactive = await this.scheduler.suggestFollowups();
      const base = this.resaleMagicMode
        ? (this.context.language === "hi"
          ? "AI provider unavailable hai. Main ab template + scheduling fallback mode mein kaam kar raha hoon (resale-focused)."
          : "AI provider is unavailable. I switched to template + scheduling fallback mode (resale-focused).")
        : (this.context.language === "hi"
          ? "Main parse kar sakta hoon: send, schedule, templates, leads summary."
          : "I can handle sends, schedules, templates, and lead summaries.");
      const showSetupHint = !this.context.meta?.aiSetupHintShown;
      const setupHint = showSetupHint ? `\n\n${getAiSetupHint(this.context.language)}` : "";
      const proactiveMsg = proactive ? `${base} ${proactive}` : base;
      const msg = `${proactiveMsg}${setupHint}`.trim();
      if (showSetupHint) {
        this.context.meta.aiSetupHintShown = true;
      }
      this.context.addMessage("agent", msg);
      const suggestions = this.resaleMagicMode
        ? [
          "Run `waba resale magic-start --client acme-realty`",
          "Send day-1 follow-up template",
          "Enable AI provider (Ollama / Anthropic / xAI / OpenRouter)"
        ]
        : ["Send welcome template", "Schedule follow-up tomorrow 10am", "Enable AI provider (Ollama / Anthropic / xAI / OpenRouter)"];
      return fallbackResponse(msg, suggestions);
    }

    try {
      const data = await chatCompletionJson(this.config, {
        system: sys,
        user,
        maxTokens: 900
      });
      const parsed = data && typeof data === "object" ? data : safeJsonParse(String(data || ""));
      if (!parsed || typeof parsed !== "object") {
        return this.heuristicParse(userInput, "I could not parse structured response. Please rephrase.");
      }
      const response = {
        message: String(parsed.message || "Done."),
        actions: this.resaleMagicMode
          ? normalizeResaleActions(normalizeActions(parsed.actions))
          : normalizeActions(parsed.actions),
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map((x) => String(x)) : [],
        needsInput: !!parsed.needsInput
      };
      this.context.addMessage("agent", response.message);
      await this.appendAuditEvent({
        type: "chat_ai_proposal",
        resale_mode: this.resaleMagicMode,
        prompt: String(userInput || "").slice(0, 400),
        proposal: {
          message: response.message,
          actions: response.actions
        }
      });
      return response;
    } catch (err) {
      logger.warn(`chat llm fallback: ${err?.message || err}`);
      await this.appendAuditEvent({
        type: "chat_ai_error",
        message: String(err?.message || err),
        resale_mode: this.resaleMagicMode
      });
      return this.heuristicParse(userInput, "I hit an AI parsing issue, but I can still run direct commands.");
    }
  }

  async appendAuditEvent(event) {
    try {
      if (!this.runtimeCtx?.appendMemory) return;
      await this.runtimeCtx.appendMemory(this.runtimeCtx.client, event);
    } catch {}
  }

  async execute(action) {
    if (!this.runtimeCtx) await this.init();
    const tool = String(action?.tool || "");
    const params = action?.params && typeof action.params === "object" ? { ...action.params } : {};

    if (tool === "template.list") {
      const rows = await this.runtimeCtx.whatsapp.listTemplates({ limit: Number(params.limit || 20) });
      return {
        summary: `Found ${(rows?.data || []).length} template(s).`,
        details: JSON.stringify((rows?.data || []).slice(0, 5).map((x) => `${x.name} (${x.status})`))
      };
    }

    if (tool === "memory.show") {
      const client = safeClientName(params.client || this.runtimeCtx.client);
      const events = await readMemory(client, { limit: Number(params.limit || 20) });
      return {
        summary: `Loaded ${events.length} memory event(s) for ${client}.`,
        details: events.slice(-3).map((e) => e.type).join(", ")
      };
    }

    if (tool === "followup.schedule_non_responders") {
      const scheduled = await this.scheduler.scheduleNonResponders(params.time || "tomorrow 10am");
      return {
        summary: `Scheduled ${scheduled.scheduled} follow-up(s).`,
        details: `RunAt: ${scheduled.runAt} (considered ${scheduled.considered})`
      };
    }

    if (!this.runtimeCtx.registry.has(tool)) {
      throw new Error(`Unknown tool: ${tool}`);
    }

    if (tool === "message.send_text" && params.to) params.to = String(params.to).replace(/[^\d]/g, "");
    if (tool === "message.send_text_buttons" && params.to) params.to = String(params.to).replace(/[^\d]/g, "");
    if (tool === "template.send" && params.to) params.to = String(params.to).replace(/[^\d]/g, "");
    if (tool === "schedule.add_text" && params.to) params.to = String(params.to).replace(/[^\d]/g, "");
    if (tool === "schedule.add_template" && params.to) params.to = String(params.to).replace(/[^\d]/g, "");
    if (tool === "lead.schedule_followup" && params.to) params.to = String(params.to).replace(/[^\d]/g, "");
    if (tool === "lead.schedule_followup" && params.phone && !params.to) params.to = String(params.phone).replace(/[^\d]/g, "");
    if (tool === "lead.tag" && params.phone) params.phone = String(params.phone).replace(/[^\d]/g, "");
    if (tool === "lead.escalate_human" && params.phone) params.phone = String(params.phone).replace(/[^\d]/g, "");
    if (tool === "jaspers.plan_reply" && params.from) params.from = String(params.from).replace(/[^\d]/g, "");

    const out = await this.runtimeCtx.registry.get(tool).execute(this.runtimeCtx, params);
    return {
      summary: action.description || `${tool} completed`,
      details: out?.ok === true ? "OK" : JSON.stringify(out || {})
    };
  }

  showLeadsSummary() {
    const leads = this.context.getLeadsSummary();
    // eslint-disable-next-line no-console
    console.log(chalk.cyan("\nLeads Summary:\n"));
    // eslint-disable-next-line no-console
    console.log(chalk.white(`Total: ${leads.total}`));
    // eslint-disable-next-line no-console
    console.log(chalk.green(`Active: ${leads.active}`));
    // eslint-disable-next-line no-console
    console.log(chalk.yellow(`Pending follow-up: ${leads.pending}`));
    // eslint-disable-next-line no-console
    console.log(chalk.gray(`Qualified: ${leads.qualified}\n`));
  }

  showSchedule() {
    const rows = this.context.actionResults
      .filter((x) => ["schedule.add_text", "schedule.add_template"].includes(String(x?.action?.tool || "")))
      .slice(-20);
    // eslint-disable-next-line no-console
    console.log(chalk.cyan("\nScheduled Messages:\n"));
    if (!rows.length) {
      // eslint-disable-next-line no-console
      console.log(chalk.gray("No scheduled messages in this session.\n"));
      return;
    }
    for (const [i, s] of rows.entries()) {
      // eslint-disable-next-line no-console
      console.log(chalk.white(`${i + 1}. ${s?.action?.description || s?.action?.tool}`));
    }
    // eslint-disable-next-line no-console
    console.log("");
  }

  showStatus() {
    // eslint-disable-next-line no-console
    console.log(chalk.cyan("\nAgent Status:\n"));
    // eslint-disable-next-line no-console
    console.log(chalk.white(`Client: ${this.context.client || "None"}`));
    // eslint-disable-next-line no-console
    console.log(chalk.white(`Messages sent today: ${this.context.getMessagesSentToday()}`));
    // eslint-disable-next-line no-console
    console.log(chalk.white(`Active conversations: ${this.context.getActiveConversations()}`));
    // eslint-disable-next-line no-console
    console.log(chalk.white(`Response rate: ${this.context.getResponseRate()}%\n`));
  }

  heuristicParse(userInput, fallbackMessage) {
    const raw = String(userInput || "").trim();
    const text = raw.toLowerCase();
    if (/^\s*whoami\s*$/i.test(raw) || /\bwho am i\b/.test(text)) {
      return {
        message: `Client: ${this.context.client || "default"} | Language: ${this.context.language || "en"} | Leads: ${this.context.getActiveLeadsCount()}`,
        actions: [],
        suggestions: ["Show templates", "Show memory"],
        needsInput: false
      };
    }
    if (/\b(send|share|push)\b.*\bwelcome\b|\bwelcome text\b|\bwelcome message\b/.test(text)) {
      let to = normalizePhone(raw);
      if (!to) {
        const knownLead = Array.isArray(this.context.leads)
          ? this.context.leads.find((l) => normalizePhone(l?.phone))
          : null;
        if (knownLead) to = normalizePhone(knownLead.phone);
      }
      if (!to) {
        return {
          message: "Please include recipient number, or first load/announce leads. Example: Send welcome text to +919812345678.",
          actions: [],
          suggestions: ["whoami", "show templates", "show memory", "send welcome text to +919812345678"],
          needsInput: true
        };
      }
      return {
        message: `I can send a welcome text to ${to}. Approve Execute to proceed.`,
        actions: [{
          tool: "message.send_text",
          params: {
            to,
            body: `Hi! Welcome to ${this.context.client || "our service"}. How can we help you today?`
          },
          description: `Send welcome text to ${to}`
        }],
        suggestions: ["Execute all", "Edit message body"],
        needsInput: false
      };
    }
    if (/\bshow\b.*\btemplates?\b/.test(text)) {
      return {
        message: "I can fetch templates now.",
        actions: [{ tool: "template.list", params: { limit: 20 }, description: "List templates" }],
        suggestions: ["Send template to a lead", "Show memory"],
        needsInput: false
      };
    }
    if (/\bshow\b.*\bmemory\b/.test(text)) {
      return {
        message: "I can load recent client memory.",
        actions: [{ tool: "memory.show", params: { client: this.context.client || "default", limit: 20 }, description: "Show memory" }],
        suggestions: ["List templates", "Schedule follow-up"],
        needsInput: false
      };
    }
    if (fallbackMessage === null) {
      return null;
    }
    return fallbackResponse(
      fallbackMessage || "Please tell me the exact action to run.",
      ["whoami", "show templates", "show memory", "send welcome text to +919812345678"]
    );
  }
}

module.exports = { WhatsAppAgent, getAiSetupHint };
