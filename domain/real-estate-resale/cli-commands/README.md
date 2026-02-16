# Real Estate Resale CLI Commands

## Activation

```bash
waba resale activate --client acme-realty
```

## Lead Import

```bash
waba resale import --client acme-realty --csv ./leads.csv --magic-start
```

CSV columns:

- `name`
- `phone`
- `last_message_date`
- `property_interested`
- `notes`

## Magic Start

```bash
waba resale magic-start --client acme-realty
```

## 48h Metrics

```bash
waba resale metrics --client acme-realty --hours 48
```

## Template Pack

```bash
waba resale templates --lang hi
waba resale templates --lang en
```
