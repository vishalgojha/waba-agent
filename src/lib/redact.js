function redactToken(token) {
  if (!token) return token;
  const t = String(token);
  if (t.length <= 10) return "***";
  return `${t.slice(0, 4)}***${t.slice(-4)}`;
}

module.exports = { redactToken };

