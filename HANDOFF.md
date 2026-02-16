# WABA Agent Handoff

Last updated: 2026-02-16

## Snapshot
- Repo: `waba-agent`
- Branch: `main`
- Latest base commits:
  - `470c83d` fix(orderai): harden profile persistence and ignore local state
  - `fa0e45f` feat: add chat gateway, multi-provider AI, and resale magic mode
- Working tree is not clean (multiple parallel in-progress changes exist).

## Completed in this handoff cycle
- Added wizard prompt abstraction:
  - `src/lib/wizard/prompts.js`
  - `src/lib/wizard/prompter.js`
- Refactored onboarding to use wizard prompter and cancellation handling:
  - `src/commands/onboard.js`
- Added onboarding Hatch choice:
  - Prompt: `How do you want to hatch your bot?`
  - Choices: `tui`, `web`, `later`
  - `tui` now points to `waba hatch --start-gateway`.
- Added optional observability bootstrap and startup wiring:
  - `src/lib/observability.js`
  - `src/index.js`
  - `src/server/gateway.js`
  - `src/server/webhook.js`
- Expanded CI workflow test coverage:
  - `.github/workflows/ci.yml` now runs smoke + chat + gateway + ai + resale tests.
- Added rate limiting middleware (per IP + client):
  - `src/lib/http-rate-limit.js`
  - integrated in `src/server/gateway.js`
  - integrated in `src/server/webhook.js`
- Added optional durable execution queue wrapper for gateway actions:
  - `src/lib/queue/execution-queue.js`
  - integrated in `src/server/gateway.js` (`/api/session/:id/execute`)
  - defaults to direct execution unless `WABA_QUEUE_ENABLED=true` and `REDIS_URL` configured
- Added real hatch terminal command (approval queue aware):
  - `src/commands/hatch.js`
  - `src/lib/hatch/gateway-client.js`
  - registered in `src/index.js`
  - supports send message, pending list, approve/reject, session switch, summary
  - gateway auto-start support via `--start-gateway`
- Added hatch tests and CI coverage:
  - `src/tests/hatch.test.js`
  - `package.json` script `test:hatch`
  - `.github/workflows/ci.yml` includes hatch tests
- Added production validation runner + checklist:
  - `scripts/validate-production.js`
  - `docs/production-validation-checklist.md`
  - `package.json` script `validate:prod`
  - latest report: `.agent/production-validation-latest.json` (currently failing due missing credentials/config)

## Pending work
- Keep high-risk action flow approval-gated (no unsafe auto-execute).
- Install and configure telemetry packages in runtime environments (`@sentry/node`, OpenTelemetry packages).
- Install BullMQ and configure Redis in runtime environments for durable queue mode.
- Finish production validation pass:
  - real Meta credential flow
  - real AI provider flow
  - 24h window/template/rate-limit checks
  - full resale 48h demo scenario

## Safety invariants (do not break)
- Keep approval gating for high-risk actions.
- No eval/shell execution in action execution flow.
- Keep Hindi/English behavior natural and domain-scoped for resale.
- Do not remove existing commands.

## Files changed in this cycle
- `src/commands/onboard.js`
- `src/lib/wizard/prompter.js`
- `src/lib/wizard/prompts.js`
- `src/lib/observability.js`
- `src/lib/http-rate-limit.js`
- `src/lib/queue/execution-queue.js`
- `src/lib/hatch/gateway-client.js`
- `src/commands/hatch.js`
- `src/index.js`
- `src/server/gateway.js`
- `src/server/webhook.js`
- `src/tests/hatch.test.js`
- `scripts/validate-production.js`
- `docs/production-validation-checklist.md`
- `package.json`
- `.github/workflows/ci.yml`
- `.agent/checklist.json`
- `.agent/state.json`

## Commands run and outcomes
- `node --check src/commands/onboard.js` -> pass
- `node --check src/lib/wizard/prompter.js` -> pass
- `node --check src/lib/wizard/prompts.js` -> pass
- `node --check src/lib/observability.js` -> pass
- `node --check src/index.js` -> pass
- `node --check src/commands/hatch.js` -> pass
- `node --check src/lib/hatch/gateway-client.js` -> pass
- `node --check src/server/gateway.js` -> pass
- `node --check src/server/webhook.js` -> pass
- `node --check src/lib/http-rate-limit.js` -> pass
- `node --check src/lib/queue/execution-queue.js` -> pass
- `cmd /c npm run test:chat` -> pass
- `cmd /c npm run test:gateway` -> pass
- `cmd /c npm run test:hatch` -> pass
- `cmd /c npm run test:ai` -> pass
- `cmd /c npm run test:resale` -> pass
- `cmd /c npm run validate:prod -- --json` -> pass (report generated; preflight summary contains expected FAIL checks for missing creds)
- `cmd /c node -e "require('./src/commands/onboard.js'); console.log('onboard-load-ok')"` -> pass

## Known blockers / caveats
- PowerShell execution policy blocks `npm.ps1`; use `cmd /c npm ...` or update policy.
- There are unrelated pre-existing changes in working tree from other pending takes.

## Resume checklist for next agent
1. Run `git status --short` and preserve unrelated changes.
2. Run real credential e2e validation (Meta + chosen AI provider).
3. Run full 48h resale magic mode scenario and capture pass/fail.
4. Install telemetry + queue runtime deps in deployment envs and verify startup.
5. Re-run `cmd /c npm run test:chat`, `test:gateway`, `test:hatch`, `test:ai`, `test:resale`.
6. Run `cmd /c npm run validate:prod -- --strict` after credentials are configured.

## Refresh handoff memory
- Edit checklist source: `.agent/checklist.json`
- Refresh generated state: `npm run handoff:update`
- Generated output: `.agent/state.json`
