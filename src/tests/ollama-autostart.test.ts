// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");

const { shouldAutoStartOllama } = require("../lib/ai/ollama-autostart");

test("shouldAutoStartOllama true for explicit ollama provider", () => {
  const prev = process.env.WABA_OLLAMA_AUTOSTART;
  delete process.env.WABA_OLLAMA_AUTOSTART;
  try {
    assert.equal(shouldAutoStartOllama({ aiProvider: "ollama" }), true);
  } finally {
    process.env.WABA_OLLAMA_AUTOSTART = prev;
  }
});

test("shouldAutoStartOllama true for localhost 11434 base url", () => {
  const prev = process.env.WABA_OLLAMA_AUTOSTART;
  delete process.env.WABA_OLLAMA_AUTOSTART;
  try {
    assert.equal(shouldAutoStartOllama({ openaiBaseUrl: "http://127.0.0.1:11434/v1" }), true);
    assert.equal(shouldAutoStartOllama({ openaiBaseUrl: "http://localhost:11434/v1" }), true);
  } finally {
    process.env.WABA_OLLAMA_AUTOSTART = prev;
  }
});

test("shouldAutoStartOllama false when autostart is disabled", () => {
  const prev = process.env.WABA_OLLAMA_AUTOSTART;
  process.env.WABA_OLLAMA_AUTOSTART = "0";
  try {
    assert.equal(shouldAutoStartOllama({ aiProvider: "ollama" }), false);
  } finally {
    process.env.WABA_OLLAMA_AUTOSTART = prev;
  }
});

