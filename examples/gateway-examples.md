# `waba gateway` Examples

## Start Gateway UI

```bash
waba gateway start --host 127.0.0.1 --port 3010 --client acme-realty --lang en
```

## Open In Browser

```text
http://127.0.0.1:3010/
```

## API Examples

### Start/Resume Session

```bash
curl -X POST http://127.0.0.1:3010/api/session/start ^
  -H "Content-Type: application/json" ^
  -d "{\"client\":\"acme-realty\",\"language\":\"en\"}"
```

### Send Message

```bash
curl -X POST http://127.0.0.1:3010/api/session/<SESSION_ID>/message ^
  -H "Content-Type: application/json" ^
  -d "{\"message\":\"I got 5 new leads from 99acres for ACME\"}"
```

### Execute Proposed Actions

```bash
curl -X POST http://127.0.0.1:3010/api/session/<SESSION_ID>/execute ^
  -H "Content-Type: application/json" ^
  -d "{\"actions\":[],\"allowHighRisk\":false}"
```
