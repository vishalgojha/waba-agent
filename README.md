# waba-agent

Production-focused CLI for WhatsApp Business Cloud API automation (India SMB use cases), plus a safe "agent mode" that only executes registered tools (no shell/code exec).

## What This Solves (India SMB)

- Webhook setup + local verify server (`hub.challenge` + optional signature check)
- Inbound handling: text, images (vision describe), voice notes (Whisper-style transcription)
- Templates: list + send approved templates
- Lead qualification: classify intent, extract fields, draft next reply (EN/HI)
- Outbound scheduling: locally stored schedules + `schedule run`
- Sellable delivery: per-client config + append-only memory store

## Install

From npm (recommended for users):

```bash
npm i -g @vishalgojha/waba-agent
```

If PowerShell blocks `npm` (execution policy), use:

```bash
npm.cmd i -g @vishalgojha/waba-agent
```

From source (recommended for contributors):

```bash
git clone https://github.com/vishalgojha/waba-agent.git
cd waba-agent
npm.cmd i
npm.cmd link
```

You now have `waba` and `waba-agent` on your PATH.

Meta permissions you typically need on the token/app:

- `whatsapp_business_messaging`
- `whatsapp_business_management`

## Quick Start

1) Save auth (token + IDs)

```bash
waba auth login --token "<PERMANENT_TOKEN>" --phone-id "<PHONE_NUMBER_ID>" --business-id "<WABA_ID>"
```

2) Generate verify token + setup values for Meta

```bash
waba webhook setup --url "https://YOUR_PUBLIC_URL"
```

3) Run local webhook server (dev)

```bash
waba webhook start --port 3000
```

4) Simulate an inbound webhook POST

```bash
waba webhook test --target "http://localhost:3000/webhook" --text "Hi, price please"
```

5) List templates

```bash
waba template list
```

6) Send a pre-approved template (high risk: outbound costs)

```bash
waba send template 9198XXXXXX --template-name "my_template" --language en --params "[\"Vishal\",\"Tomorrow 10 AM\"]"
```

7) Agent mode (plan -> confirm -> execute tools)

```bash
waba agent run "handle leads for real estate client" --client "acme-realty" --webhook-url "https://YOUR_PUBLIC_URL"
```

## CLI Commands (Core)

- `waba auth login|status|logout`
- `waba webhook setup|start|serve|validate|test`
- `waba template list`
- `waba template create|preview|submit-for-approval|status|wait|analytics|drafts|sync-drafts`
- `waba send template|text`
- `waba agent run`
- `waba memory list|show|forget`
- `waba schedule add-text|add-template|list|cancel|run`
- `waba clients add|list|switch|billing`
- `waba analytics start`
- `waba metrics --client acme --days 30`
- `waba integrate google-sheets`
- `waba integrate status|webhook|hubspot|zoho`
- `waba sync leads --to sheets`
- `waba cost estimate|actual`
- `waba optout add|list|check|remove`
- `waba campaign create|import|schedule|run|status|stop|list`
- `waba onboard --client acme --wizard`
- `waba report weekly --client acme --email client@acme.com`
- `waba flow create|add-step|show|list|test`
- `waba payments enable|status|send-link|webhook-handler`
- `waba deploy render docker`
- `waba logs tail`
- `waba leads missed`
- `waba export leads`

Global flags:

- `--no-memory`: disables writes to `~/.waba/context` (useful for privacy-sensitive deployments)
- `--debug`: verbose logs
- `--json`: JSON output where supported

## Project Structure

```
waba-agent/
  bin/waba.js
  src/index.js
  src/commands/
    agent.js
    auth.js
    analytics.js
    campaign.js
    clients.js
    cost.js
    integrate.js
    memory.js
    onboard.js
    optout.js
    report.js
    schedule.js
    send.js
    sync.js
    template.js
    webhook.js
  src/lib/
    agent/ (planner + executor)
    ai/openai.js
    analytics.js
    campaign-runner.js
    campaign-store.js
    client-config.js
    clients.js
    config.js
    doctor.js
    email.js
    graph-error.js
    http.js
    logger.js
    memory.js
    message-parser.js
    multimodal-stubs.js
    optout-store.js
    paths.js
    prompt.js
    redact.js
    report.js
    schedule-store.js
    template-drafts.js
    tools.js
    tools/ (registry + builtins)
    webhook/ (server + signature + parse + payloads)
    whatsapp.js
  src/server/
    analytics.js
    webhook.js
```

## Auth + Security Notes

- Token storage:
  - By default `waba auth login` stores token in `~/.waba/config.json`.
  - For stricter security, prefer environment variables: `WABA_TOKEN`, `WABA_PHONE_ID`, `WABA_BUSINESS_ID`.
  - Optional: set `WABA_APP_SECRET` to verify `X-Hub-Signature-256` on webhook POSTs.
- Logging:
  - No silent failures. Errors are printed with Graph error hints when possible.
  - Do not paste customer PII into public issue trackers.
- Privacy:
  - Memory is append-only JSONL under `~/.waba/context/<client>/memory.jsonl`.
  - Add your own retention policy per client and local regulations.
  - To use a different home directory, set `WABA_HOME`.

## Running The Webhook Server (Recommended)

Local receiver (Express):

```bash
waba webhook start --port 3000
```

With ngrok tunnel (for Meta callback testing):

```bash
waba webhook start --port 3000 --ngrok --verbose
```

Ngrok note: set `NGROK_AUTHTOKEN` in your environment if required by your ngrok account/plan.

If you have `OPENAI_API_KEY` set, you can enable smarter lead classification + suggested replies:

```bash
waba webhook start --port 3000 --ngrok --verbose --llm
```

Safety defaults:

- No outbound replies unless you pass `--allow-outbound`.
- Even with `--allow-outbound`, outbound steps require terminal confirmation (high-risk).
- For production non-interactive servers, add `--allow-high-risk` (only after testing).

## Client Onboarding Wizard (Sellable)

Fast setup for a new client: writes per-client defaults, creates the lead-qualification flow, and can generate local template drafts.

```bash
waba onboard --client acme --wizard --industry real-estate
```

Start webhook server as part of onboarding (blocks; use Ctrl+C to stop):

```bash
waba onboard --client acme --wizard --start-webhook --ngrok --verbose
```

## Deploy (Docker)

Generate a self-contained Docker deploy folder:

```bash
waba deploy render docker --client acme --out deploy-acme --port 3000
cd deploy-acme
copy .env.example .env
docker compose up -d --build
```

## Logs (Support)

Tail memory logs (redacted by default):

```bash
waba logs tail --client acme --lines 200
waba logs tail --client acme --follow
waba logs tail --client acme --type inbound_message --follow
```

## Missed Leads (Ops)

Find leads who messaged but did not get a reply yet (from local memory logs):

```bash
waba leads missed --client acme --since 24h --min-age 5m
```

## Export (Sales Demo)

Export unique leads to CSV (from local memory + flow state):

```bash
waba export leads --client acme --since 7d --out leads.csv
```

Export and push to Google Sheets (requires `integrate google-sheets`):

```bash
waba export leads --client acme --since 7d --to sheets
```

## Follow-Ups (Compliant)

Plan follow-ups (no sends):

```bash
waba leads followup --client acme --mode plan --since 7d --min-age 10m
```

Send now (within 24h uses text, outside 24h uses template if provided):

```bash
waba leads followup --client acme --mode send --template-name "acme_followup" --template-language en --yes
```

Auto-fill template params from fields (default keys: `["name","client"]`):

- `templates.followup.paramsFromFields` (example): `["name","client","location","budget"]`
- `businessName` (optional): if set in `client.json`, it will be used for the `client` param

Schedule for later (then run `waba schedule run` via cron):

```bash
waba leads followup --client acme --mode schedule --template-name "acme_followup" --schedule-delay 10m --yes
```

## Google Sheets Sync (Fastest CRM Upsell)

1) Print Apps Script template:

```bash
waba integrate google-sheets --print-apps-script
```

2) Deploy it as a Web App and copy the URL.

3) Configure + test:

```bash
waba integrate google-sheets --client acme --apps-script-url "<WEB_APP_URL>" --test
```

4) Sync leads:

```bash
waba sync leads --to sheets --client acme --days 30
```

## CRM Integrations (Major Upsell)

Generic webhook sink:

```bash
waba integrate webhook --client acme --url "https://your-crm.example.com/waba" --test
```

HubSpot:

```bash
waba integrate hubspot --client acme --token "<HUBSPOT_PRIVATE_APP_TOKEN>" --test
waba sync leads --to hubspot --client acme --days 30
```

Zoho (India DC default):

```bash
waba integrate zoho --client acme --token "<ZOHO_ACCESS_TOKEN>" --dc in --module Leads --test
waba sync leads --to zoho --client acme --days 30
```

Auto-push from webhook:

- By default, if any CRM integration is configured, the webhook server pushes `lead_qualified` when a flow reaches `end`.
- Control via `~/.waba/context/<client>/client.json`:
  - `integrations.autoPush.enabled` (default: auto if integrations exist)
  - `integrations.autoPush.mode`: `flow_end` or `every_inbound`

## Opt-Out Compliance (Required)

```bash
waba optout add 919812345678 --reason "user-request" --client acme
waba optout check 919812345678 --client acme
waba optout list --client acme
```

Outbound sends and campaigns will refuse to message opted-out numbers.

## Broadcast Campaigns (Revenue Feature)

Create + import audience + run (template-only):

```bash
waba campaign create "summer-sale" --template sale_offer --language en --client acme
waba campaign import --id <CAMPAIGN_ID> --csv leads.csv
waba campaign run --id <CAMPAIGN_ID> --throttle-ms 400
```

Stop automatically if opt-out rate is too high:

```bash
waba campaign run --id <CAMPAIGN_ID> --stop-optout-rate 0.05
```

## Weekly Reports (Sales Enabler)

Generate + save HTML report:

```bash
waba report weekly --client acme
```

Send via SMTP (set env vars):

```bash
setx WABA_SMTP_HOST "smtp.gmail.com"
setx WABA_SMTP_PORT "587"
setx WABA_SMTP_USER "you@gmail.com"
setx WABA_SMTP_PASS "app-password"
setx WABA_SMTP_FROM "Reports <you@gmail.com>"

waba report weekly --client acme --email client@acme.com
```

## Template Management (Business Critical)

Create a template (submits to Meta for approval):

```bash
waba template create --name "followup_1" --category MARKETING --language en_US --body "Hi {{1}}, quick follow up: are you still interested?"
```

Preview (local render of {{1}}, {{2}} placeholders):

```bash
waba template preview --name "followup_1" --params "[\"John\"]"
```

Local drafts (for fast client customization):

```bash
waba template create --name "followup_1" --category MARKETING --language en_US --body "Hi {{1}}..." --save-draft
waba template drafts
```

Check status + wait for approval:

```bash
waba template status --name "followup_1"
waba template wait --name "followup_1" --timeout 30m --interval 20s
```

Compare local drafts vs remote templates:

```bash
waba template sync-drafts --client acme
```

## Payments (India) - Razorpay

Enable:

```bash
waba payments enable razorpay --client acme --key "<KEY_ID>" --secret "<KEY_SECRET>" --webhook-secret "<WEBHOOK_SECRET>"
waba payments status --client acme
```

Send a payment link (high risk: outbound):

```bash
waba payments send-link --client acme --to 919812345678 --amount 5000 --desc "Consultation fee" 
```

Webhook handler (for payment events):

```bash
waba payments webhook-handler start --client acme --port 3002
```

## Flow Builder (Premium Feature)

Create a lead qualification flow (preset):

```bash
waba flow create lead-qualification --client acme
```

Add a custom question:

```bash
waba flow add-step --client acme --flow lead-qualification --type question --field preferred_time --text "What time works best for you?"
```

Add a condition + handoff (example):

```bash
waba flow add-step --client acme --flow lead-qualification --type condition --if "budget >= 10L" --then-step 8 --else-step 9
waba flow add-step --client acme --flow lead-qualification --type handoff --reason high_budget --text "Thanks. Our senior advisor will contact you shortly."
```

Test locally (no WhatsApp send):

```bash
waba flow test --client acme --flow lead-qualification --from 919812345678 --text "Hi"
```

Webhook integration:

- `client.json` includes `flows.active` and `flows.intentMap`
- When enabled, incoming messages advance the flow and the webhook server proposes the next outbound question/reply.
- Staff notifications: set `handoff.notifyNumber` in `client.json`. The webhook server can notify staff on `flow_end`, `handoff`, `unknown_intent`, or `call_request`.

Security notes:

- This server binds to `127.0.0.1` by default. It is not public unless you run `--ngrok` or bind to `0.0.0.0` / deploy it on a server.
- Do not expose your webhook endpoint publicly without signature verification (`WABA_APP_SECRET`) and basic network controls.
- Follow Meta/WhatsApp policies: outbound marketing must use approved templates and consent/opt-outs.

## Rate Limits (Reality Check)

Meta enforces rate limits (example: ~200 calls/hour per user). `waba-agent` retries on `429` + `5xx` with exponential backoff, but you should still batch calls and avoid polling.

## AI (Optional)

Enable lead classification, image describe, and voice transcription:

```bash
setx OPENAI_API_KEY "..."
setx WABA_OPENAI_MODEL "gpt-4o-mini"
setx WABA_OPENAI_VISION_MODEL "gpt-4o-mini"
setx WABA_OPENAI_TRANSCRIBE_MODEL "gpt-4o-mini-transcribe"
```

OpenAI-compatible providers (Groq/OpenRouter) can work by setting:

```bash
setx OPENAI_BASE_URL "https://api.groq.com/openai/v1"
```

## How To Sell This As A Service (INR 25k-125k setup + retainer)

Deliverable clients understand:

- 1 WhatsApp number connected to Cloud API
- Webhook server on their VPS (or your managed hosting)
- Lead auto-replies + human handoff rules
- Templates prepared and tracked for approval
- Daily "missed lead" follow-up schedule
- Weekly report: leads, response time, conversion stages

Fiverr/Upwork gig positioning:

- "WhatsApp Business API automation for Indian SMBs (leads, follow-ups, appointment booking)"
- "Meta WhatsApp Cloud API setup + webhooks + AI agent replies"

Upsells:

- CRM webhook integration (Sheets, Zoho, HubSpot, custom)
- Multilingual replies (EN/HI/MR/TA)
- Message scheduling campaigns (template-only, compliant)
- Analytics dashboard (Looker / CSV exports)

## Compliance + Costs (Read This)

- Outbound marketing requires pre-approved templates.
- WhatsApp Cloud API is per-message billed (India rates change; rough ballpark: utility ~INR 0.11, marketing ~INR 0.78). This toolkit warns about costs but does not calculate pricing.
- Follow Meta platform policies and WhatsApp commerce/messaging rules. Add client-specific disclaimers and opt-outs.

## Scheduling (Safe)

Text schedules will only send if the recipient is inside the 24-hour customer-service window; otherwise they fail closed.
For follow-ups outside 24h, schedule a template.

```bash
waba schedule add-text 919812345678 --at "2026-02-16T10:00:00+05:30" --body "Hi, checking in..."
waba schedule add-template 919812345678 --at "2026-02-16T10:00:00+05:30" --template-name "acme_followup" --language en --params "[\"Vishal\",\"ACME\"]"
waba schedule run
```
