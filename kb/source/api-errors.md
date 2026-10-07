---
id: api-errors
title: API Error Codes
category: developers
locale: en
status: active
valid_from: 2025-01-01
tags:
  - api
  - errors
  - reference
---

# API Error Codes

## Error response format

Every failed request returns a JSON object with an `error` member containing `code`, `message`, and `request_id`. The `code` is a stable identifier you can branch on in code; the message is human-readable and may change without notice. Log the `request_id` with every failure, because support uses it to trace the request across services.

## Common error codes

DemoDesk uses prefixed codes grouped by cause. Authentication and token problems use the ERR-A series; quota and throttling problems use ERR-B; resource lookup problems use ERR-C. The three codes you will encounter most often are:

- ERR-A17 means that the API token has expired.
- ERR-B04 means that the account has exceeded its API request quota.
- ERR-C91 means that the requested workspace does not exist.

Treat these as definitive: an ERR-A17 will never succeed on retry until you obtain a fresh token.

## Retrying failed requests

Only retry requests that are safe to repeat: GET, DELETE, PUT, or writes that carried an `Idempotency-Key`. Retry 429 and 5xx responses with exponential backoff and jitter. Never retry ERR-A17 or ERR-C91 without changing the request, because the same failure will recur. After three failed attempts, surface the error and include the `request_id` in any escalation.
