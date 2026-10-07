---
id: api-idempotency
title: Idempotency Keys
category: developers
locale: en
status: active
valid_from: 2025-01-01
tags:
  - api
  - idempotency
  - retries
---

# Idempotency Keys

## Why idempotency matters

A network timeout is ambiguous: the server may have processed a write even though the client never saw a response. Retrying blindly can create duplicate tickets, comments, or charges. Idempotency keys remove that ambiguity by letting you repeat a write safely and receive the original result instead of creating a second resource.

## Sending an Idempotency-Key header

Add an `Idempotency-Key` header to POST and PATCH requests; a UUID version 4 is the recommended value. DemoDesk stores the first response for a key and replays it for subsequent requests that reuse the same key with an identical body, adding an `Idempotency-Replayed: true` response header. Reusing a key with a different body returns 422 and no write occurs.

## Key expiration

Stored responses expire after 24 hours. After expiry the same key is treated as new, so generate a fresh key for each logical operation rather than reusing one per day. Keys are scoped per workspace and endpoint, so the same value may be used independently across endpoints without collision. Avoid predictable sequential key values; prefer random identifiers to prevent cross-request interference.
