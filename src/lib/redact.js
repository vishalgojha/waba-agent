function redactToken(token) {
  if (!token) return token;
  const t = String(token);
  if (t.length <= 10) return "***";
  return `${t.slice(0, 4)}***${t.slice(-4)}`;
}

function redactPhone(s) {
  const t = String(s || "");
  const digits = t.replace(/\D/g, "");
  if (digits.length < 8) return "***";
  return `${digits.slice(0, 2)}***${digits.slice(-4)}`;
}

module.exports = { redactToken, redactPhone };
