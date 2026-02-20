const express = require("express");
const fs = require("fs-extra");
const path = require("path");

const { logger } = require("../lib/logger");
const { getConfig, setConfig } = require("../lib/config");
const { addOrUpdateClient } = require("../lib/clients");
const { computeMetrics } = require("../lib/analytics");
const { getMissedLeads } = require("../lib/followup");
const { safeClientName } = require("../lib/creds");
const { redactToken } = require("../lib/redact");
const { PersistentMemory, sessionPath } = require("../lib/chat/memory");
const { GatewaySessionManager } = require("../lib/chat/gateway");
const { getClientConfig } = require("../lib/client-config");
const { hasAiProviderConfigured } = require("../lib/ai/openai");
const {
  isResaleMagicEnabled,
  importResaleLeads,
  queueMagicNurture,
  computeResaleMagicMetrics,
  activateResaleMagic,
  buildShareableWin,
  readLeadStore
} = require("../lib/domain/real-estate-resale");
const pkg = require("../../package.json");
const { initObservability } = require("../lib/observability");
const { createRateLimitMiddleware, getRequestClientKey } = require("../lib/http-rate-limit");
const { createExecutionQueue } = require("../lib/queue/execution-queue");

function normalizeClientCreds(cfg, clientName) {
  const c = safeClientName(clientName || cfg?.activeClient || "default");
  const rec = cfg?.clients?.[c] || {};
  return {
    client: c,
    hasToken: !!rec.token,
    tokenMasked: rec.token ? redactToken(rec.token) : null,
    phoneNumberId: rec.phoneNumberId || null,
    wabaId: rec.wabaId || null
  };
}

function isDigits(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function aiFieldsForProvider(provider) {
  const p = String(provider || "").trim().toLowerCase();
  if (p === "openai" || p === "ollama") {
    return { keyField: "openaiApiKey", modelField: "openaiModel", baseUrlField: "openaiBaseUrl" };
  }
  if (p === "anthropic") {
    return { keyField: "anthropicApiKey", modelField: "anthropicModel", baseUrlField: "anthropicBaseUrl" };
  }
  if (p === "xai") {
    return { keyField: "xaiApiKey", modelField: "xaiModel", baseUrlField: "xaiBaseUrl" };
  }
  if (p === "openrouter") {
    return { keyField: "openrouterApiKey", modelField: "openrouterModel", baseUrlField: "openrouterBaseUrl" };
  }
  return { keyField: null, modelField: null, baseUrlField: null };
}

function gatewayHtml(defaultClient, defaultLanguage) {
  const client = String(defaultClient || "default");
  const lang = defaultLanguage === "hi" ? "hi" : "en";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WABA Gateway</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />
    <style>
      :root {
        --bg0: #f7f2e6;
        --bg1: #e7f0ef;
        --bg2: #d7e7ff;
        --card: rgba(255,255,255,0.78);
        --ink: #17202a;
        --muted: #556270;
        --brand: #0f766e;
        --brand2: #1d4ed8;
        --danger: #b91c1c;
        --ok: #166534;
        --ring: rgba(15, 118, 110, 0.25);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Sora", "Avenir Next", "Segoe UI Variable", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at 12% 16%, rgba(15,118,110,0.18), transparent 38%),
          radial-gradient(circle at 88% 14%, rgba(29,78,216,0.22), transparent 36%),
          linear-gradient(130deg, var(--bg0), var(--bg1) 48%, var(--bg2));
        overflow: hidden;
      }
      .noise {
        position: fixed; inset: 0; pointer-events: none; opacity: 0.08;
        background-image: radial-gradient(#000 0.55px, transparent 0.55px);
        background-size: 3px 3px;
      }
      .layout {
        display: grid;
        grid-template-columns: 320px 1fr;
        gap: 18px;
        height: 100vh;
        padding: 18px;
      }
      .panel {
        background: var(--card);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255,255,255,0.7);
        box-shadow: 0 18px 40px rgba(19, 34, 56, 0.16);
        border-radius: 20px;
      }
      .side {
        display: grid;
        grid-template-rows: auto auto 1fr auto;
        gap: 12px;
        padding: 16px;
        animation: rise .45s ease both;
      }
      .brand h1 {
        margin: 0;
        font-size: 24px;
        line-height: 1.05;
        letter-spacing: 0.4px;
      }
      .brand p { margin: 8px 0 0; color: var(--muted); font-size: 13px; }
      .controls label { display: block; font-size: 11px; color: var(--muted); margin: 8px 0 5px; text-transform: uppercase; letter-spacing: 0.08em; }
      .controls input, .controls select, .composer textarea {
        width: 100%;
        border-radius: 12px;
        border: 1px solid rgba(23, 32, 42, 0.15);
        padding: 10px 11px;
        font: inherit;
        background: rgba(255,255,255,0.85);
        color: var(--ink);
      }
      .controls input:focus, .controls select:focus, .composer textarea:focus {
        outline: none;
        border-color: var(--brand);
        box-shadow: 0 0 0 4px var(--ring);
      }
      .btnRow { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
      button {
        border: 0;
        border-radius: 12px;
        padding: 10px 12px;
        font: 600 13px "Sora", sans-serif;
        cursor: pointer;
        transition: transform .18s ease, box-shadow .18s ease, opacity .18s ease;
      }
      button:hover { transform: translateY(-1px); }
      button:active { transform: translateY(1px); }
      .btnPrimary {
        background: linear-gradient(135deg, var(--brand), var(--brand2));
        color: #fff;
        box-shadow: 0 10px 22px rgba(29, 78, 216, 0.24);
      }
      .btnGhost { background: rgba(255,255,255,0.9); color: var(--ink); border: 1px solid rgba(23, 32, 42, 0.12); }
      .stats { display: grid; gap: 8px; }
      .stat {
        border-radius: 12px;
        padding: 10px 11px;
        background: linear-gradient(120deg, rgba(255,255,255,0.85), rgba(255,255,255,0.6));
        border: 1px solid rgba(23, 32, 42, 0.08);
        animation: rise .45s ease both;
      }
      .stat .k { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
      .stat .v { margin-top: 5px; font-weight: 700; font-size: 17px; }
      .sessions {
        min-height: 120px;
        overflow: auto;
        border: 1px solid rgba(23,32,42,0.08);
        border-radius: 12px;
        background: rgba(255,255,255,0.55);
      }
      .sessionItem {
        padding: 10px 11px;
        border-bottom: 1px dashed rgba(23,32,42,0.08);
        cursor: pointer;
      }
      .sessionItem:hover { background: rgba(15, 118, 110, 0.08); }
      .sessionItem:last-child { border-bottom: 0; }
      .mono { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; color: var(--muted); }
      .main {
        display: grid;
        grid-template-rows: auto 1fr auto auto;
        gap: 12px;
        padding: 14px;
        animation: rise .55s ease both;
      }
      .topbar {
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: 10px;
        align-items: center;
      }
      .title {
        font-size: 22px;
        font-weight: 700;
      }
      .pill {
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 12px;
        background: rgba(15,118,110,0.12);
        color: #0f766e;
      }
      .chat {
        overflow: auto;
        padding: 8px;
        border-radius: 16px;
        border: 1px solid rgba(23, 32, 42, 0.09);
        background: linear-gradient(180deg, rgba(255,255,255,0.8), rgba(255,255,255,0.55));
      }
      .msgWrap {
        display: flex;
        margin: 9px 0;
        animation: rise .25s ease both;
      }
      .msgWrap.user { justify-content: flex-end; }
      .msg {
        max-width: min(76ch, 88%);
        border-radius: 15px;
        padding: 10px 12px;
        line-height: 1.42;
        font-size: 14px;
      }
      .msg.agent {
        background: rgba(255,255,255,0.93);
        border: 1px solid rgba(23,32,42,0.08);
      }
      .msg.user {
        background: linear-gradient(140deg, #0f766e, #1d4ed8);
        color: #fff;
      }
      .quick {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .chip {
        border: 1px solid rgba(23,32,42,0.15);
        background: rgba(255,255,255,0.9);
        border-radius: 999px;
        padding: 7px 11px;
        font-size: 12px;
        cursor: pointer;
      }
      .chip:hover { background: rgba(15, 118, 110, 0.1); border-color: rgba(15,118,110,0.32); }
      .actions {
        border: 1px solid rgba(23,32,42,0.08);
        border-radius: 14px;
        padding: 10px;
        background: rgba(255,255,255,0.68);
      }
      .actions h3 { margin: 0 0 10px; font-size: 14px; }
      .actionRow {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: center;
        padding: 8px;
        border-radius: 10px;
        border: 1px solid rgba(23,32,42,0.06);
        margin-bottom: 7px;
        background: rgba(255,255,255,0.9);
      }
      .actionRow .desc { font-size: 13px; }
      .risk { font-size: 11px; padding: 4px 8px; border-radius: 999px; }
      .risk.high { background: rgba(185,28,28,0.14); color: var(--danger); }
      .risk.low { background: rgba(22,101,52,0.15); color: var(--ok); }
      .composer {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
      }
      .composer textarea {
        resize: none;
        min-height: 56px;
        max-height: 200px;
      }
      .hint { color: var(--muted); font-size: 12px; }
      .stagger > * { opacity: 0; transform: translateY(8px); animation: rise .38s ease forwards; }
      .stagger > *:nth-child(2) { animation-delay: .04s; }
      .stagger > *:nth-child(3) { animation-delay: .08s; }
      .stagger > *:nth-child(4) { animation-delay: .12s; }
      .stagger > *:nth-child(5) { animation-delay: .16s; }
      @keyframes rise { from { opacity: 0; transform: translateY(10px) scale(.99);} to { opacity: 1; transform: translateY(0) scale(1);} }
      @media (max-width: 980px) {
        body { overflow: auto; }
        .layout { grid-template-columns: 1fr; height: auto; min-height: 100vh; }
        .main { min-height: 72vh; }
      }
    </style>
  </head>
  <body>
    <div class="noise"></div>
    <div class="layout">
      <aside class="panel side stagger">
        <div class="brand">
          <h1>WABA<br/>Gateway</h1>
          <p>Local UI + conversational API bridge</p>
        </div>
        <div class="controls">
          <label>Client</label>
          <input id="clientInput" value="${client}" />
          <label>Language</label>
          <select id="langInput">
            <option value="en"${lang === "en" ? " selected" : ""}>English</option>
            <option value="hi"${lang === "hi" ? " selected" : ""}>Hindi/English</option>
          </select>
          <div class="btnRow">
            <button class="btnPrimary" id="startBtn">Start Session</button>
            <button class="btnGhost" id="refreshBtn">Refresh</button>
          </div>
        </div>
        <div class="stats">
          <div class="stat"><div class="k">Pending Follow-ups</div><div class="v" id="sMissed">-</div></div>
          <div class="stat"><div class="k">Inbound Leads</div><div class="v" id="sLeads">-</div></div>
          <div class="stat"><div class="k">Avg Response</div><div class="v" id="sResp">-</div></div>
        </div>
        <div>
          <div class="mono" style="margin-bottom:6px;">Recent Sessions</div>
          <div class="sessions" id="sessionList"></div>
        </div>
      </aside>

      <main class="panel main">
        <div class="topbar">
          <div class="title">Conversational Control Room</div>
          <div class="pill" id="sessionBadge">No session</div>
          <label class="pill" style="cursor:pointer;">
            <input id="allowHighRisk" type="checkbox" style="vertical-align:middle; margin-right:6px;" />
            Allow high-risk execute
          </label>
        </div>

        <section class="chat" id="chatLog"></section>

        <section class="actions" id="actionsBox" style="display:none;">
          <h3>Proposed Actions</h3>
          <div id="actionList"></div>
          <div style="display:flex; gap:8px;">
            <button class="btnPrimary" id="execAllBtn">Execute All</button>
            <button class="btnGhost" id="clearActionsBtn">Clear</button>
          </div>
        </section>

        <section>
          <div class="quick" id="quickChips"></div>
          <div style="height:8px;"></div>
          <div class="composer">
            <textarea id="msgInput" placeholder="Type naturally. Example: I got 5 new leads from 99acres for ACME"></textarea>
            <button class="btnPrimary" id="sendBtn">Send</button>
          </div>
          <div class="hint">Enter to send. Shift+Enter for newline.</div>
        </section>
      </main>
    </div>

    <script>
      const state = {
        sessionId: null,
        actions: []
      };

      const $ = (id) => document.getElementById(id);
      const chatLog = $("chatLog");

      function escapeHtml(s) {
        return String(s || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\\"/g, "&quot;");
      }

      async function api(url, options = {}) {
        const res = await fetch(url, {
          method: options.method || "GET",
          headers: { "Content-Type": "application/json", ...(options.headers || {}) },
          body: options.body ? JSON.stringify(options.body) : undefined
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || ("HTTP " + res.status));
        }
        return res.json();
      }

      function addMessage(role, content) {
        const wrap = document.createElement("div");
        wrap.className = "msgWrap " + (role === "user" ? "user" : "agent");
        const bubble = document.createElement("div");
        bubble.className = "msg " + (role === "user" ? "user" : "agent");
        bubble.innerHTML = escapeHtml(content).replace(/\\n/g, "<br/>");
        wrap.appendChild(bubble);
        chatLog.appendChild(wrap);
        chatLog.scrollTop = chatLog.scrollHeight;
      }

      function setSessionBadge() {
        $("sessionBadge").textContent = state.sessionId ? ("Session " + state.sessionId) : "No session";
      }

      function renderActions() {
        const box = $("actionsBox");
        const list = $("actionList");
        list.innerHTML = "";
        if (!state.actions.length) {
          box.style.display = "none";
          return;
        }
        box.style.display = "block";
        for (const a of state.actions) {
          const row = document.createElement("div");
          row.className = "actionRow";
          const highRisk = ["message.send_text", "template.send", "schedule.add_text", "schedule.add_template"].includes(a.tool);
          row.innerHTML = "<div><div class='desc'>" + escapeHtml(a.description || a.tool) + "</div><div class='mono'>" + escapeHtml(a.tool) + "</div></div>" +
            "<span class='risk " + (highRisk ? "high" : "low") + "'>" + (highRisk ? "HIGH RISK" : "LOW RISK") + "</span>";
          list.appendChild(row);
        }
      }

      function renderSuggestions(suggestions) {
        const chips = $("quickChips");
        chips.innerHTML = "";
        for (const s of suggestions || []) {
          const b = document.createElement("button");
          b.className = "chip";
          b.textContent = s;
          b.onclick = () => {
            $("msgInput").value = s;
            sendMessage();
          };
          chips.appendChild(b);
        }
      }

      async function startSession() {
        const client = $("clientInput").value.trim() || "default";
        const language = $("langInput").value || "en";
        const data = await api("/api/session/start", {
          method: "POST",
          body: { client, language }
        });
        state.sessionId = data.session.id;
        setSessionBadge();
        chatLog.innerHTML = "";
        for (const m of data.session.context.messages || []) addMessage(m.role, m.content);
        if (!(data.session.context.messages || []).length) {
          addMessage("agent", data.greeting || "Session ready.");
        }
        state.actions = [];
        renderActions();
        await refreshSummary();
        await refreshSessions();
      }

      async function sendMessage() {
        const msg = $("msgInput").value.trim();
        if (!msg) return;
        if (!state.sessionId) await startSession();
        addMessage("user", msg);
        $("msgInput").value = "";
        const allowHighRisk = $("allowHighRisk").checked;
        const out = await api("/api/session/" + encodeURIComponent(state.sessionId) + "/message", {
          method: "POST",
          body: { message: msg, autoExecute: false, allowHighRisk }
        });
        addMessage("agent", out.response.message || "Done.");
        state.actions = Array.isArray(out.response.actions) ? out.response.actions : [];
        renderActions();
        renderSuggestions(out.response.suggestions || []);
        await refreshSummary();
        await refreshSessions();
      }

      async function executeAll() {
        if (!state.sessionId || !state.actions.length) return;
        const allowHighRisk = $("allowHighRisk").checked;
        const out = await api("/api/session/" + encodeURIComponent(state.sessionId) + "/execute", {
          method: "POST",
          body: { actions: state.actions, allowHighRisk }
        });
        addMessage("agent", "Execution complete: " + out.execution.ok + " ok, " + out.execution.failed + " failed.");
        state.actions = [];
        renderActions();
        await refreshSummary();
      }

      async function refreshSummary() {
        const client = $("clientInput").value.trim() || "default";
        const summary = await api("/api/summary?client=" + encodeURIComponent(client) + "&days=30");
        $("sMissed").textContent = String(summary.missedLeads || 0);
        $("sLeads").textContent = String(summary.metrics?.leads?.inboundMessages ?? "-");
        const avg = summary.metrics?.responses?.avgMinutes;
        $("sResp").textContent = Number.isFinite(avg) ? (avg.toFixed(1) + "m") : "-";
      }

      async function refreshSessions() {
        const client = $("clientInput").value.trim() || "default";
        const out = await api("/api/sessions?client=" + encodeURIComponent(client));
        const box = $("sessionList");
        box.innerHTML = "";
        for (const s of out.sessions || []) {
          const row = document.createElement("div");
          row.className = "sessionItem";
          row.innerHTML = "<div><strong>" + escapeHtml(s.id) + "</strong></div><div class='mono'>" +
            escapeHtml(s.language + " | msgs " + s.messages + " | " + (s.lastUsedAt || "")) + "</div>";
          row.onclick = async () => {
            const data = await api("/api/session/start", {
              method: "POST",
              body: { client, sessionId: s.id, language: s.language || "en" }
            });
            state.sessionId = data.session.id;
            setSessionBadge();
            chatLog.innerHTML = "";
            for (const m of data.session.context.messages || []) addMessage(m.role, m.content);
            state.actions = [];
            renderActions();
          };
          box.appendChild(row);
        }
      }

      $("startBtn").onclick = () => startSession().catch(err => alert(err.message));
      $("refreshBtn").onclick = () => Promise.all([refreshSummary(), refreshSessions()]).catch(err => alert(err.message));
      $("sendBtn").onclick = () => sendMessage().catch(err => alert(err.message));
      $("execAllBtn").onclick = () => executeAll().catch(err => alert(err.message));
      $("clearActionsBtn").onclick = () => { state.actions = []; renderActions(); };
      $("msgInput").addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) {
          ev.preventDefault();
          sendMessage().catch(err => alert(err.message));
        }
      });

      (async () => {
        try {
          await startSession();
          setInterval(() => refreshSummary().catch(() => {}), 25000);
        } catch (err) {
          addMessage("agent", "Gateway init failed: " + err.message);
        }
      })();
    </script>
  </body>
</html>`;
}

async function startGatewayServer({ host = "127.0.0.1", port = 3010, client = "default", language = "en" } = {}) {
  await initObservability({ serviceName: "waba-gateway", serviceVersion: pkg.version });

  const cfg = await getConfig();
  const manager = new GatewaySessionManager();
  const executionQueue = createExecutionQueue({ manager, logger });
  const app = express();

  app.disable("etag");
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.set("Surrogate-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(
    createRateLimitMiddleware({
      windowMs: Math.max(1_000, Number(process.env.WABA_GATEWAY_RATE_WINDOW_MS || 60_000)),
      max: Math.max(1, Number(process.env.WABA_GATEWAY_RATE_MAX || 180)),
      keyFn: (req) => getRequestClientKey(req, cfg.activeClient || client || "default"),
      responseMessage: "gateway_rate_limited",
      onLimit: (info) => {
        logger.warn(
          `gateway rate limit hit key=${info.key} ip=${info.ip} client=${info.client} count=${info.count} max=${info.max}`
        );
      }
    })
  );

  const repoRoot = path.resolve(__dirname, "..", "..");
  const candidateUiPaths = [
    process.env.WABA_GATEWAY_UI ? path.resolve(process.env.WABA_GATEWAY_UI) : null,
    path.resolve(process.cwd(), "public", "waba-gateway-ui.html"),
    path.resolve(process.cwd(), "public", "index.html"),
    path.resolve(repoRoot, "public", "waba-gateway-ui.html"),
    path.resolve(repoRoot, "public", "index.html")
  ].filter(Boolean);

  app.get("/", async (_req, res) => {
    for (const p of candidateUiPaths) {
      // eslint-disable-next-line no-await-in-loop
      if (await fs.pathExists(p)) {
        // eslint-disable-next-line no-await-in-loop
        const html = await fs.readFile(p, "utf8");
        res.status(200).type("text/html").send(html);
        return;
      }
    }
    res.status(200).type("text/html").send(gatewayHtml(client || cfg.activeClient || "default", language || "en"));
  });

  app.get("/api/health", (_req, res) => {
    const sessions = manager.list();
    res.json({
      ok: true,
      service: "waba-gateway",
      version: pkg.version,
      uptime: Math.floor(process.uptime()),
      sessions: sessions.length
    });
  });

  app.get("/api/config", async (_req, res) => {
    const current = await getConfig();
    const creds = normalizeClientCreds(current, current.activeClient || "default");
    const provider = String(current.aiProvider || "ollama").trim().toLowerCase();
    const fields = aiFieldsForProvider(provider);
    const aiModel = fields.modelField ? current[fields.modelField] : null;
    const aiBaseUrl = fields.baseUrlField ? current[fields.baseUrlField] : null;
    const aiHasKey = fields.keyField ? !!current[fields.keyField] : false;
    res.json({
      ok: true,
      activeClient: current.activeClient || "default",
      graphVersion: current.graphVersion || "v20.0",
      hasToken: creds.hasToken,
      hasOpenAi: !!current.openaiApiKey,
      hasAi: hasAiProviderConfigured(current),
      aiProvider: provider || null,
      aiModel: aiModel || null,
      aiBaseUrl: aiBaseUrl || null,
      aiHasKey,
      webhookUrl: current.lastPublicWebhookUrl || current.webhookUrl || null
    });
  });

  app.post("/api/config/ai", async (req, res) => {
    try {
      const allowed = new Set(["ollama", "openai", "anthropic", "xai", "openrouter"]);
      const provider = String(req.body?.provider || "ollama").trim().toLowerCase();
      const model = String(req.body?.model || "").trim();
      const baseUrl = String(req.body?.baseUrl || "").trim();
      const apiKey = String(req.body?.apiKey || "").trim();

      if (!allowed.has(provider)) {
        res.status(400).json({ ok: false, error: "provider_invalid" });
        return;
      }
      if (!model) {
        res.status(400).json({ ok: false, error: "model_required" });
        return;
      }

      const fields = aiFieldsForProvider(provider);
      const patch = { aiProvider: provider };
      if (fields.modelField) patch[fields.modelField] = model;
      if (fields.baseUrlField) {
        if (baseUrl) patch[fields.baseUrlField] = baseUrl;
        else if (provider === "ollama") patch[fields.baseUrlField] = "http://127.0.0.1:11434/v1";
      }
      if (fields.keyField) {
        if (apiKey) patch[fields.keyField] = apiKey;
        else if (provider === "ollama") patch[fields.keyField] = "ollama";
      }

      await setConfig(patch);
      const latest = await getConfig();
      const outFields = aiFieldsForProvider(provider);
      const aiModel = outFields.modelField ? latest[outFields.modelField] : null;
      const aiBaseUrl = outFields.baseUrlField ? latest[outFields.baseUrlField] : null;
      res.json({
        ok: true,
        aiProvider: latest.aiProvider || null,
        aiModel: aiModel || null,
        aiBaseUrl: aiBaseUrl || null,
        hasAi: hasAiProviderConfigured(latest)
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/clients/:client/credentials", async (req, res) => {
    try {
      const current = await getConfig();
      const c = safeClientName(req.params.client || current.activeClient || "default");
      const out = normalizeClientCreds(current, c);
      res.json({ ok: true, ...out });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/clients/:client/credentials", async (req, res) => {
    try {
      const current = await getConfig();
      const c = safeClientName(req.params.client || current.activeClient || "default");
      const token = String(req.body?.token || "").trim();
      const phoneNumberId = String(req.body?.phoneNumberId || req.body?.phoneId || "").trim();
      const wabaId = String(req.body?.wabaId || req.body?.businessId || "").trim();

      if (!token) {
        res.status(400).json({ ok: false, error: "token_required" });
        return;
      }
      if (!phoneNumberId || !isDigits(phoneNumberId)) {
        res.status(400).json({ ok: false, error: "phone_number_id_invalid" });
        return;
      }
      if (!wabaId || !isDigits(wabaId)) {
        res.status(400).json({ ok: false, error: "waba_id_invalid" });
        return;
      }

      await addOrUpdateClient(
        c,
        {
          token,
          phoneNumberId,
          wabaId
        },
        { makeActive: req.body?.makeActive !== false }
      );

      const latest = await getConfig();
      const out = normalizeClientCreds(latest, c);
      res.json({ ok: true, saved: true, ...out, activeClient: latest.activeClient || c });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/sessions", async (req, res) => {
    const c = safeClientName(req.query.client || cfg.activeClient || "default");
    const sessions = manager.list({ client: c });
    res.json({ ok: true, sessions, data: sessions });
  });

  app.get("/api/history", async (req, res) => {
    try {
      const c = safeClientName(req.query.client || cfg.activeClient || "default");
      const limit = Math.max(1, Math.min(200, Number(req.query.limit || 20)));
      const rows = await PersistentMemory.history({ client: c, limit });
      const history = [];
      for (const row of rows.slice(0, limit)) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const p = sessionPath(c, row.sessionId);
          // eslint-disable-next-line no-await-in-loop
          if (!(await fs.pathExists(p))) continue;
          // eslint-disable-next-line no-await-in-loop
          const snapshot = await fs.readJson(p);
          const msgs = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
          for (const m of msgs.slice(-20)) {
            history.push({
              session_id: row.sessionId,
              sessionId: row.sessionId,
              role: m.role || "unknown",
              content: m.content || "",
              timestamp: m.ts || row.updatedAt || null,
              pending_actions: 0
            });
          }
        } catch {}
      }
      history.sort((a, b) => Date.parse(b.timestamp || "") - Date.parse(a.timestamp || ""));
      res.json({ ok: true, rows, history: history.slice(0, limit) });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/summary", async (req, res) => {
    try {
      const c = safeClientName(req.query.client || cfg.activeClient || "default");
      const days = Math.max(1, Math.min(365, Number(req.query.days || 30)));
      const metrics = await computeMetrics({ client: c, days, pricing: cfg.pricing });
      const missed = await getMissedLeads({
        client: c,
        sinceMs: days * 24 * 60 * 60 * 1000,
        minAgeMs: 30 * 60 * 1000,
        limit: 100
      });
      const sessions = manager.list({ client: c });
      const totalMessages = sessions.reduce((sum, s) => sum + Number(s.message_count || s.messages || 0), 0);
      const pendingActions = sessions.reduce((sum, s) => sum + Number(s.pending_actions || 0), 0);
      const executed = sessions.reduce((sum, s) => sum + Number(s.executed || 0), 0);
      const recentActivity = [];
      for (const s of sessions.slice(0, 10)) {
        if (s.last_message) {
          recentActivity.push({
            session_id: s.id,
            role: "assistant",
            content: String(s.last_message).slice(0, 140),
            timestamp: s.updated_at || s.lastUsedAt
          });
        }
      }
      const clientCfg = (await getClientConfig(c)) || {};
      const resaleMagic = isResaleMagicEnabled(clientCfg);
      const resaleMetrics = resaleMagic ? await computeResaleMagicMetrics({ client: c, hours: 48 }) : null;
      res.json({
        ok: true,
        client: c,
        metrics,
        missedLeads: missed.length,
        sessions: sessions.length,
        messages: totalMessages,
        pending: pendingActions,
        executed,
        recent_activity: recentActivity,
        resale_magic_mode: resaleMagic,
        resale_metrics: resaleMetrics
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/resale/leads", async (req, res) => {
    try {
      const c = safeClientName(req.query.client || cfg.activeClient || "default");
      const leads = await readLeadStore(c);
      res.json({ ok: true, client: c, count: leads.length, leads });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/resale/magic-mode", async (req, res) => {
    try {
      const c = safeClientName(req.body?.client || cfg.activeClient || "default");
      const enabled = req.body?.enabled !== false;
      const out = await activateResaleMagic({ client: c, enabled });
      res.json({ ok: true, client: c, enabled, config: out.config, path: out.path });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/resale/import", async (req, res) => {
    try {
      const c = safeClientName(req.body?.client || cfg.activeClient || "default");
      const out = await importResaleLeads({
        client: c,
        csvText: req.body?.csv || req.body?.csvText || "",
        pasteText: req.body?.paste || req.body?.contacts || "",
        append: req.body?.replace ? false : true
      });
      let queued = null;
      if (req.body?.queueMagic === true) {
        queued = await queueMagicNurture({ client: c, dryRun: !!req.body?.dryRun, limit: Number(req.body?.limit || 100) });
      }
      res.json({ ok: true, client: c, ...out, queued });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/resale/magic-start", async (req, res) => {
    try {
      const c = safeClientName(req.body?.client || cfg.activeClient || "default");
      const out = await queueMagicNurture({
        client: c,
        dryRun: !!req.body?.dryRun,
        limit: Number(req.body?.limit || 100)
      });
      res.json({ ok: true, client: c, ...out });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/resale/metrics", async (req, res) => {
    try {
      const c = safeClientName(req.query.client || cfg.activeClient || "default");
      const metrics = await computeResaleMagicMetrics({
        client: c,
        hours: Number(req.query.hours || 48)
      });
      const share = buildShareableWin(metrics, c);
      res.json({ ok: true, client: c, metrics, share });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/session/start", async (req, res) => {
    try {
      const c = safeClientName(req.body?.client || cfg.activeClient || "default");
      const session = await manager.start({
        sessionId: req.body?.sessionId || null,
        name: req.body?.name || req.body?.sessionName || null,
        phone: req.body?.phone || null,
        context: req.body?.context || null,
        client: c,
        language: req.body?.language || "en"
      });

      let greeting = null;
      if (!session.context.messages.length) {
        greeting = session.agent.getGreeting();
        session.context.addMessage("agent", greeting);
        await session.memory.save(session.context);
      }

      res.json({
        ok: true,
        session_id: session.id,
        session: session.getSnapshot(),
        messages: session.context.messages,
        context: session.context.toJSON(),
        memory: session.context.meta || {},
        pending_actions: session.getPendingActions(),
        greeting
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/session/:id", async (req, res) => {
    const s = await manager.get(req.params.id);
    if (!s) {
      res.status(404).json({ ok: false, error: "session_not_found" });
      return;
    }
    res.json({
      ok: true,
      session: s.getSnapshot(),
      messages: s.context.messages,
      context: s.context.toJSON(),
      memory: s.context.meta || {},
      pending_actions: s.getPendingActions()
    });
  });

  app.post("/api/session/:id/message", async (req, res) => {
    try {
      const s = await manager.get(req.params.id);
      if (!s) {
        res.status(404).json({ ok: false, error: "session_not_found" });
        return;
      }
      const msg = String(req.body?.message || req.body?.content || "").trim();
      if (!msg) {
        res.status(400).json({ ok: false, error: "message_required" });
        return;
      }
      const out = await s.sendMessage(msg, {
        autoExecute: !!req.body?.autoExecute,
        allowHighRisk: !!req.body?.allowHighRisk
      });
      res.json({
        ok: true,
        ...out,
        reply: out.response?.message || "",
        pending_actions: s.getPendingActions(),
        session: s.getSnapshot(),
        memory: s.context.meta || {}
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/session/:id/execute", async (req, res) => {
    try {
      const s = await manager.get(req.params.id);
      if (!s) {
        res.status(404).json({ ok: false, error: "session_not_found" });
        return;
      }
      const actionId = req.body?.action_id || req.body?.actionId || null;
      const queued = await executionQueue.execute({
        sessionId: s.id,
        client: s.client,
        language: s.context?.language || s.language || "en",
        actionId: actionId ? String(actionId) : null,
        actions: actionId ? [] : (Array.isArray(req.body?.actions) ? req.body.actions : []),
        allowHighRisk: !!req.body?.allowHighRisk,
        timeoutMs: Number(req.body?.timeoutMs || process.env.WABA_QUEUE_TIMEOUT_MS || 45_000)
      });
      res.json({
        ok: true,
        execution: queued.execution,
        queue: queued.queue || null,
        pending_actions: s.getPendingActions(),
        session: s.getSnapshot()
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/session/:id/reject", async (req, res) => {
    try {
      const s = await manager.get(req.params.id);
      if (!s) {
        res.status(404).json({ ok: false, error: "session_not_found" });
        return;
      }
      const actionId = req.body?.action_id || req.body?.actionId || null;
      if (!actionId) {
        res.status(400).json({ ok: false, error: "action_id_required" });
        return;
      }
      const out = await s.rejectPendingById(actionId);
      res.json({
        ok: true,
        removed: out.removed,
        pending: out.pending,
        pending_actions: s.getPendingActions(),
        session: s.getSnapshot()
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(port, host, () => resolve(s));
  });

  logger.ok(`Gateway UI: http://${host}:${port}/`);
  logger.info("Use this for local conversational control + execution.");
  return { server };
}

module.exports = { startGatewayServer };
