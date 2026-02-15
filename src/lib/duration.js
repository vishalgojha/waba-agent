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

module.exports = { parseDurationMs };

