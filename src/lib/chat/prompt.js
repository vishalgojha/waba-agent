function toolCatalog({ resaleOnly = false } = {}) {
  if (resaleOnly) {
    return [
      "template.send(to, templateName, language, params)",
      "message.send_text_buttons(to, body, buttons)",
      "lead.schedule_followup(to, days, templateName?, language?, params?)",
      "lead.tag(phone, tag, note?)",
      "lead.escalate_human(phone, reason, priority?)"
    ];
  }
  return [
    "message.send_text(to, body)",
    "message.send_text_buttons(to, body, buttons)",
    "template.send(to, templateName, language, params)",
    "schedule.add_text(to, body, runAt)",
    "schedule.add_template(to, templateName, language, params, runAt)",
    "lead.schedule_followup(to, days, templateName?, language?, params?)",
    "lead.tag(phone, tag, note?)",
    "lead.escalate_human(phone, reason, priority?)",
    "template.list(limit)",
    "memory.show(client)"
  ];
}

function responseSchema({ resaleOnly = false } = {}) {
  const tools = resaleOnly
    ? "template.send | message.send_text_buttons | lead.schedule_followup | lead.tag | lead.escalate_human"
    : "message.send_text | message.send_text_buttons | template.send | schedule.add_text | schedule.add_template | lead.schedule_followup | lead.tag | lead.escalate_human | template.list | memory.show";
  return `{
  "message": "string",
  "actions": [
    {
      "tool": "${tools}",
      "params": {},
      "description": "short summary"
    }
  ],
  "suggestions": ["string"],
  "needsInput": false
}`;
}

function buildSystemPrompt({ client, language, context, domainProfile = null, domainPrompt = "" }) {
  const resaleOnly = domainProfile?.vertical === "real-estate-resale";
  const langHint = language === "hi"
    ? "Reply in Hindi-English mix suitable for India SMB operators."
    : "Reply in clear concise English for India SMB operators.";
  const activeClient = client || "default";
  const ctx = String(context || "").slice(-2500);

  return [
    `You are a conversational WhatsApp business operations agent for client "${activeClient}".`,
    langHint,
    resaleOnly
      ? "Domain: India real-estate resale only (no new launches/projects)."
      : "Domain: India SMB (real estate, education, clinics, retail).",
    "Prioritize safe operations. If data is missing, ask clarifying questions.",
    "Never claim sends succeeded unless an action is emitted and executed.",
    "For outbound actions, keep actions explicit and minimal.",
    resaleOnly
      ? "If query is out-of-scope (stocks, medicine, coding, legal advice), politely refuse and redirect to resale lead ops."
      : "Keep the conversation focused on business operations.",
    "Use only these tool names:",
    ...toolCatalog({ resaleOnly }).map((x) => `- ${x}`),
    "Return strict JSON only with this schema:",
    responseSchema({ resaleOnly }),
    resaleOnly
      ? "Capture/extract structured fields when present: budget_min, budget_max, preferred_bhk, preferred_area, timeline_months, last_intent, lead_score."
      : "",
    domainPrompt ? "Domain prompt:\n" + String(domainPrompt).slice(0, 5000) : "",
    "Current context summary:",
    ctx || "No prior context."
  ].filter(Boolean).join("\n");
}

function buildUserPrompt({ userInput, history, activeLeads, scheduledCount, recentActivity }) {
  return [
    "Conversation history:",
    history || "None",
    "",
    `Active leads: ${activeLeads}`,
    `Scheduled messages: ${scheduledCount}`,
    `Recent activity: ${recentActivity || "None"}`,
    "",
    "User message:",
    String(userInput || "")
  ].join("\n");
}

module.exports = { buildSystemPrompt, buildUserPrompt };
