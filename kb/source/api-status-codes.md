---
id: api-status-codes
title: HTTP Status Codes
category: developers
locale: en
status: active
valid_from: 2025-01-01
tags:
  - api
  - http
  - status
---

# HTTP Status Codes

## 2xx success

A 2xx response means the request was processed. GET and PATCH return 200 OK with the resource in the body; POST returns 201 Created with the new resource and a `Location` header pointing at it; DELETE returns 204 No Content with an empty body. Treat the whole 2xx range as success and parse the body when one is present.

## 4xx client errors

Client errors mean the request cannot succeed as sent. Common cases: 400 for malformed JSON, 401 for missing or expired credentials (ERR-A17), 403 for insufficient scopes or role, 404 for a missing resource (ERR-C91), 409 for conflicting concurrent updates, 422 for validation failures, and 429 for throttling or exhausted quota (ERR-B04). Retrying these unchanged will not help.

## 5xx server errors

Server errors mean the fault is on the DemoDesk side. 500 indicates an unhandled failure, 502 and 503 indicate gateway or capacity problems, and 504 indicates a timeout. Retry with exponential backoff, but only when the request is safe to repeat or carried an `Idempotency-Key`. If 5xx responses persist for more than a few minutes, check the DemoDesk status page and open a support ticket with the `request_id`.
