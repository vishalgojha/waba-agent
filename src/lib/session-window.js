const fs = require("fs-extra");
const dayjs = require("dayjs");

const { memoryPath } = require("./memory");

function normalizeNumber(x) {
  const t = String(x || "").trim().replace(/^\+/, "");
  return t.replace(/[^0-9]/g, "");
}

async function readLastLines(filePath, n) {
  if (!(await fs.pathExists(filePath))) return [];
  const stat = await fs.stat(filePath);
  const size = stat.size;
  if (!size) return [];

  const fd = await fs.open(filePath, "r");
  try {
    const chunkSize = 64 * 1024;
    let pos = size;
    let buf = "";
    while (pos > 0 && buf.split("\n").filter(Boolean).length < n + 5) {
      const readSize = Math.min(chunkSize, pos);
      pos -= readSize;
      const b = Buffer.allocUnsafe(readSize);
      // eslint-disable-next-line no-await-in-loop
      await fs.read(fd, b, 0, readSize, pos);
      buf = b.toString("utf8") + buf;
      if (buf.length > 2 * 1024 * 1024) buf = buf.slice(-2 * 1024 * 1024);
    }
    const lines = buf.split("\n").filter(Boolean);
    return lines.slice(Math.max(0, lines.length - n));
  } finally {
    await fs.close(fd);
  }
}

function parseJsonLinesReverse(lines) {
  const out = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      out.push(JSON.parse(lines[i]));
    } catch {}
  }
  return out;
}

function isInboundEvent(e) {
  const t = String(e?.type || "");
  if (!t) return false;
  if (t === "inbound_message") return true;
  if (t.startsWith("inbound_")) return true;
  return false;
}

async function getLastInboundAt({ client, from, maxLines = 5000 } = {}) {
  const p = memoryPath(client || "default");
  const target = normalizeNumber(from);
  if (!target) return null;
  const lines = await readLastLines(p, maxLines);
  const events = parseJsonLinesReverse(lines);
  for (const e of events) {
    if (!isInboundEvent(e)) continue;
    const src = normalizeNumber(e.from || "");
    if (!src) continue;
    if (src !== target) continue;
    const ts = e.ts || e.timestamp || null;
    if (!ts) continue;
    const d = dayjs(ts);
    if (!d.isValid()) continue;
    return d.toISOString();
  }
  return null;
}

function in24hWindow(lastInboundIso, nowIso = new Date().toISOString()) {
  if (!lastInboundIso) return false;
  const last = dayjs(lastInboundIso);
  const now = dayjs(nowIso);
  if (!last.isValid() || !now.isValid()) return false;
  return now.diff(last, "hour", true) <= 24;
}

module.exports = {
  normalizeNumber,
  getLastInboundAt,
  in24hWindow
};

