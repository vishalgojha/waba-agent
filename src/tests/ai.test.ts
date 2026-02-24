// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { aiParseIntent } = require("../lib/ai/parser");
const { validateIntent } = require("../lib/ai/validator");
const { executeIntent } = require("../lib/ai/executor");
const { parseEditInput, normalizeChoice } = require("../lib/ui/confirm");
const { resolveAiProviderConfig, chatCompletionText } = require("../lib/ai/openai");
const { logger } = require("../lib/logger");

function silenceLogger() {
  const prevWarn = logger.warn;
  const prevError = logger.error;
  logger.warn = () => {};
  logger.error = () => {};
  return () => {
    logger.warn = prevWarn;
    logger.error = prevError;
  };
}

test("parser: uses mocked LLM JSON response", async () => {
  const prevFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              action: "send_text",
              client: "acme",
              phone: "919812345678",
              template: null,
              params: null,
              message: "Thanks for your inquiry",
              datetime: null,
              confidence: 0.93
            })
          }
        }
      ]
    })
  });

  try {
    const intent = await aiParseIntent("send thanks to 919812345678 for acme", { openaiApiKey: "x" });
    assert.equal(intent.action, "send_text");
    assert.equal(intent.client, "acme");
    assert.equal(intent.phone, "+919812345678");
    assert.equal(intent.message, "Thanks for your inquiry");
  } finally {
    global.fetch = prevFetch;
  }
});

test("parser: falls back to heuristic parsing when LLM times out", async () => {
  const prevFetch = global.fetch;
  const restoreLogger = silenceLogger();
  global.fetch = async () => {
    const err = new Error("Request timed out");
    err.name = "AbortError";
    throw err;
  };

  try {
    const intent = await aiParseIntent("schedule reminder for acme tomorrow 10am to +919812345678", { openaiApiKey: "x" });
    assert.equal(intent.action, "schedule_text");
    assert.equal(intent.client, "acme");
    assert.equal(intent.phone, "+919812345678");
    assert.ok(intent.datetime, "expected datetime from fallback parser");
  } finally {
    global.fetch = prevFetch;
    restoreLogger();
  }
});

test("parser: supports anthropic provider response format", async () => {
  const prevFetch = global.fetch;
  global.fetch = async (url, opts) => {
    assert.match(String(url), /api\.anthropic\.com\/v1\/messages/);
    assert.equal(opts.headers["x-api-key"], "anth-key");
    assert.equal(opts.headers["anthropic-version"], "2023-06-01");
    return {
      ok: true,
      text: async () => JSON.stringify({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              action: "list_templates",
              client: null,
              phone: null,
              template: null,
              params: null,
              message: null,
              datetime: null,
              confidence: 0.8
            })
          }
        ]
      })
    };
  };

  try {
    const intent = await aiParseIntent("list my templates", {
      aiProvider: "anthropic",
      anthropicApiKey: "anth-key",
      anthropicModel: "claude-3-5-haiku-latest"
    });
    assert.equal(intent.action, "list_templates");
  } finally {
    global.fetch = prevFetch;
  }
});

test("provider resolver: detects openrouter/xai/anthropic from env keys", () => {
  const prev = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    XAI_API_KEY: process.env.XAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY
  };
  try {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    process.env.OPENROUTER_API_KEY = "or-key";
    assert.equal(resolveAiProviderConfig({}).provider, "openrouter");
    delete process.env.OPENROUTER_API_KEY;

    process.env.XAI_API_KEY = "x-key";
    assert.equal(resolveAiProviderConfig({}).provider, "xai");
    delete process.env.XAI_API_KEY;

    process.env.ANTHROPIC_API_KEY = "a-key";
    assert.equal(resolveAiProviderConfig({}).provider, "anthropic");
  } finally {
    process.env.OPENROUTER_API_KEY = prev.OPENROUTER_API_KEY;
    process.env.XAI_API_KEY = prev.XAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = prev.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = prev.OPENAI_API_KEY;
  }
});

test("provider resolver: defaults to local Ollama when no hosted key is available", () => {
  const prev = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    XAI_API_KEY: process.env.XAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    WABA_OPENAI_MODEL: process.env.WABA_OPENAI_MODEL,
    OPENAI_MODEL: process.env.OPENAI_MODEL
  };
  try {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.WABA_OPENAI_MODEL;
    delete process.env.OPENAI_MODEL;

    const runtime = resolveAiProviderConfig({});
    assert.equal(runtime.provider, "openai");
    assert.equal(runtime.baseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(runtime.model, "deepseek-coder-v2:16b");
    assert.equal(runtime.apiKey, "ollama");
  } finally {
    process.env.OPENROUTER_API_KEY = prev.OPENROUTER_API_KEY;
    process.env.XAI_API_KEY = prev.XAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = prev.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = prev.OPENAI_API_KEY;
    process.env.OPENAI_BASE_URL = prev.OPENAI_BASE_URL;
    process.env.WABA_OPENAI_MODEL = prev.WABA_OPENAI_MODEL;
    process.env.OPENAI_MODEL = prev.OPENAI_MODEL;
  }
});

test("provider resolver: explicit ollama wins even when hosted keys are present", () => {
  const prev = {
    WABA_OLLAMA_BASE_URL: process.env.WABA_OLLAMA_BASE_URL,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL
  };
  try {
    delete process.env.WABA_OLLAMA_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
    const runtime = resolveAiProviderConfig({
      aiProvider: "ollama",
      openrouterApiKey: "or-key",
      openaiApiKey: "sk-test"
    });
    assert.equal(runtime.provider, "openai");
    assert.equal(runtime.localFallback, "ollama");
    assert.equal(runtime.baseUrl, "http://127.0.0.1:11434/v1");
  } finally {
    process.env.WABA_OLLAMA_BASE_URL = prev.WABA_OLLAMA_BASE_URL;
    process.env.OPENAI_BASE_URL = prev.OPENAI_BASE_URL;
  }
});

test("chat completion: retries with lightweight Ollama fallback model when primary is missing", async () => {
  const prevFetch = global.fetch;
  const prev = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    XAI_API_KEY: process.env.XAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    WABA_OPENAI_MODEL: process.env.WABA_OPENAI_MODEL,
    WABA_OLLAMA_FALLBACK_MODEL: process.env.WABA_OLLAMA_FALLBACK_MODEL
  };

  const calls = [];
  global.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.model);
    if (body.model === "deepseek-coder-v2:16b") {
      return {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => JSON.stringify({ error: { message: "model 'deepseek-coder-v2:16b' not found" } })
      };
    }
    return {
      ok: true,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "{\"ok\":true}" } }]
      })
    };
  };

  try {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    process.env.WABA_OPENAI_MODEL = "deepseek-coder-v2:16b";
    process.env.WABA_OLLAMA_FALLBACK_MODEL = "qwen2.5:7b";

    const out = await chatCompletionText({}, { user: "hello" });
    assert.equal(out.model, "qwen2.5:7b");
    assert.deepEqual(calls, ["deepseek-coder-v2:16b", "qwen2.5:7b"]);
  } finally {
    global.fetch = prevFetch;
    process.env.OPENROUTER_API_KEY = prev.OPENROUTER_API_KEY;
    process.env.XAI_API_KEY = prev.XAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = prev.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = prev.OPENAI_API_KEY;
    process.env.OPENAI_BASE_URL = prev.OPENAI_BASE_URL;
    process.env.WABA_OPENAI_MODEL = prev.WABA_OPENAI_MODEL;
    process.env.WABA_OLLAMA_FALLBACK_MODEL = prev.WABA_OLLAMA_FALLBACK_MODEL;
  }
});

test("validator: catches required fields, phone, and past datetime", () => {
  const r1 = validateIntent({
    action: "send_text",
    client: "acme",
    phone: "12345",
    message: null,
    confidence: 0.7
  });
  assert.equal(r1.valid, false);
  assert.ok(r1.errors.some((e) => e.includes("Missing required field: message")));
  assert.ok(r1.errors.some((e) => e.includes("E.164")));

  const r2 = validateIntent({
    action: "schedule_text",
    client: "acme",
    phone: "+919812345678",
    message: "Hello",
    datetime: "2020-01-01T10:00:00+05:30",
    confidence: 0.8
  });
  assert.equal(r2.valid, false);
  assert.ok(r2.errors.some((e) => e.includes("future")));
});

test("executor: rejects unsupported action and avoids shell APIs", async () => {
  const restoreLogger = silenceLogger();
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "ai", "executor.ts"), "utf8");
  assert.equal(/\bchild_process\b/.test(source), false);
  assert.equal(/\beval\s*\(/.test(source), false);

  try {
    const res = await executeIntent({ action: "__not_supported__", confidence: 0.2 });
    assert.equal(res.success, false);
    assert.match(String(res.error), /Unsupported action/);
  } finally {
    restoreLogger();
  }
});

test("confirm helpers: parse keyboard inputs and edits", () => {
  assert.equal(normalizeChoice("Y"), "yes");
  assert.equal(normalizeChoice("n"), "no");
  assert.equal(normalizeChoice("edit"), "edit");

  const patch1 = parseEditInput("phone=+919812345678,client=acme");
  assert.equal(patch1.phone, "+919812345678");
  assert.equal(patch1.client, "acme");

  const patch2 = parseEditInput("{\"params\":[\"John\"],\"confidence\":0.9}");
  assert.deepEqual(patch2.params, ["John"]);
  assert.equal(patch2.confidence, 0.9);
});
