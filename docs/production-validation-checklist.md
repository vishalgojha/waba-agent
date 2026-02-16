# Production Validation Checklist

Date:
Owner:
Client:
Environment:

## 1. Preflight
- [ ] `cmd /c npm run validate:prod -- --strict`
- Pass criteria: no `FAIL` checks in output and `.agent/production-validation-latest.json` generated.

## 2. Meta credential flow
- [ ] `waba doctor --json`
- [ ] `waba clients add <client> --token <TOKEN> --phone-id <PHONE_ID> --business-id <WABA_ID> --switch`
- [ ] `waba webhook setup --url <PUBLIC_HTTPS_URL>`
- Pass criteria:
  - token/phone/waba present
  - webhook verify token present
  - callback URL and verify token accepted in Meta dashboard

## 3. Webhook + 24h window behavior
- [ ] `waba webhook start --client <client> --port 3000 --path /webhook --verbose`
- [ ] Send inbound WhatsApp message from staging number
- [ ] Confirm inbound appears in logs/memory
- [ ] Validate in-window text reply path (24h open)
- [ ] Validate out-of-window template path (24h closed)
- Pass criteria:
  - in-window: text reply path used
  - out-of-window: template path used (or explicit safe skip if template missing)

## 4. Gateway + hatch approvals
- [ ] `waba gw --client <client> --port 3010`
- [ ] `waba hatch --client <client>`
- [ ] Send message that creates high-risk pending action
- [ ] Approve pending action
- [ ] Reject pending action
- Pass criteria:
  - high-risk actions are queued (not auto-executed)
  - approve executes exactly selected action
  - reject removes selected pending action

## 5. Rate-limit behavior
- [ ] Set strict temporary limits:
  - `WABA_GATEWAY_RATE_MAX=2`
  - `WABA_GATEWAY_RATE_WINDOW_MS=60000`
- [ ] Hit gateway endpoint repeatedly (same client/IP)
- [ ] Confirm 429 with `gateway_rate_limited`
- Pass criteria:
  - response status `429`
  - `X-RateLimit-*` headers present
  - normal requests recover after window reset

## 6. Queue durability (optional but recommended)
- [ ] Install queue deps: `npm i bullmq`
- [ ] Set:
  - `WABA_QUEUE_ENABLED=true`
  - `REDIS_URL=redis://...`
- [ ] Execute pending action via gateway `/api/session/:id/execute`
- Pass criteria:
  - response includes `queue.enabled=true` and `jobId`
  - action completes via queue worker

## 7. AI provider live validation
- [ ] Configure chosen provider key/model
- [ ] Trigger classification and suggestion flow from webhook/hatch
- Pass criteria:
  - provider used matches config
  - response quality acceptable (Hindi/English behavior natural for resale)

## 8. Resale 48h magic mode
- [ ] `waba resale magic-mode --client <client> --activate`
- [ ] Import leads
- [ ] Start magic nurture
- [ ] Review KPIs + share/export output
- Pass criteria:
  - auth -> import -> start -> replies -> approval -> metrics path works end-to-end

## 9. CI confidence
- [ ] GitHub Actions green on current branch
- [ ] Local command set passes:
  - `cmd /c npm test`
  - `cmd /c npm run test:chat`
  - `cmd /c npm run test:gateway`
  - `cmd /c npm run test:hatch`
  - `cmd /c npm run test:ai`
  - `cmd /c npm run test:resale`

## Final sign-off
- Overall result: `PASS` / `FAIL`
- Risks accepted:
- Follow-up actions:
